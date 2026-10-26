// 統括スタッフ → 大会の表示順・レギュレーションの表示順をドラッグで並べ替える
//
// jsdom has no layout, so the component tests can only fake where the rows
// are; this drives the real drag in Chromium, with a mouse and with a finger
// on a phone-sized screen, and checks what the save stored. Each test puts
// the order back the same way, so the specs after it see the seeded order.

import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from '@playwright/test';
import {GENERAL_STAFF, SAIKYOI, SHINJINOU} from '../support/fixtures';
import {loginStaffThroughForm} from '../support/ui';

const TOURNAMENT_ORDER_PATH = '/admin/tournaments/order';
const SHINJINOU_REGULATIONS_PATH = `/admin/tournaments/${SHINJINOU.id}/regulations`;

/** A point in the viewport. */
interface Point {
  x: number;
  y: number;
}

/** What a drag is made with: the mouse, or a finger. */
interface Pointer {
  down(page: Page, at: Point): Promise<void>;
  move(page: Page, to: Point): Promise<void>;
  up(page: Page): Promise<void>;
}

const mouse: Pointer = {
  async down(page, at) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
  },
  async move(page, to) {
    await page.mouse.move(to.x, to.y, {steps: 10});
  },
  async up(page) {
    await page.mouse.up();
  },
};

/**
 * A finger. Playwright has no touch drag of its own, so the touches go in
 * through the DevTools protocol, which the browser turns into touch Pointer
 * Events -- including deciding, from `touch-action`, whether the touch drags
 * the row or scrolls the page.
 */
function finger(): Pointer {
  let at: Point = {x: 0, y: 0};
  // One session for the whole drag: a session keeps track of the touch it
  // started, and refuses a move or an end it didn't see begin.
  let cdp: CDPSession | null = null;
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Point[],
  ) => {
    await cdp?.send('Input.dispatchTouchEvent', {type, touchPoints: points});
  };
  return {
    async down(page, point) {
      cdp = await page.context().newCDPSession(page);
      at = point;
      await touch('touchStart', [at]);
    },
    async move(_page, to) {
      const from = at;
      const steps = 10;
      for (let step = 1; step <= steps; step++) {
        at = {
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps,
        };
        await touch('touchMove', [at]);
      }
    },
    async up() {
      await touch('touchEnd', []);
      await cdp?.detach();
      cdp = null;
    },
  };
}

/**
 * The centre of an element, where a drag picks it up.
 * @param handle The drag handle, scrolled into view first.
 */
async function pickPoint(handle: Locator): Promise<Point> {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('the drag handle is not on screen');
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/**
 * Opens a staff screen, signing in as general staff on the way.
 * @param page The page to drive.
 * @param path The screen to open.
 */
async function openAsGeneralStaff(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await loginStaffThroughForm(page, GENERAL_STAFF);
  await expect(page).toHaveURL(path);
}

/**
 * Drags the bottom tournament onto the top one and saves.
 * @param page The page to drive, on the tournament order screen.
 * @param pointer What to drag with.
 * @param bottom The name of the tournament in the bottom row.
 * @param top The name of the tournament in the top row.
 */
async function swapTournaments(
  page: Page,
  pointer: Pointer,
  bottom: string,
  top: string,
): Promise<void> {
  const bottomRow = page.getByRole('row').filter({hasText: bottom});
  const topRow = page.getByRole('row').filter({hasText: top});
  // The handles appear once the page's scripts run.
  await pointer.down(
    page,
    await pickPoint(bottomRow.getByTitle('ドラッグして並べ替え')),
  );
  const topBox = await topRow.boundingBox();
  if (!topBox) throw new Error('the top row is not on screen');
  await pointer.move(page, {x: topBox.x + topBox.width / 2, y: topBox.y + 4});
  await pointer.up(page);
  await expect(page.getByLabel(`${bottom}の表示順`)).toHaveValue('1');

  await page.getByRole('button', {name: '保存'}).click();
  await expect(page.getByRole('status')).toHaveText('表示順を保存しました');
  // Read back from the API by the page the save reloaded.
  await expect(page.getByLabel(`${bottom}の表示順`)).toHaveValue('1');
  await expect(page.getByLabel(`${top}の表示順`)).toHaveValue('2');
}

/**
 * Drags the second regulation above the first and saves.
 *
 * Each regulation is a tall card, so the first is off screen by the time
 * the second's handle is: the row is held at the top of the viewport until
 * the page has scrolled it into first place, as staff would on a phone.
 * @param page The page to drive, on the regulations screen.
 * @param pointer What to drag with.
 * @param expected The labels, top to bottom, once saved.
 */
async function swapRegulations(
  page: Page,
  pointer: Pointer,
  expected: string[],
): Promise<void> {
  const labels = page.getByLabel('レギュレーション名');
  const handle = page
    .getByRole('group', {name: '2 番目'})
    .getByTitle('ドラッグして並べ替え');
  const from = await pickPoint(handle);
  await pointer.down(page, from);
  await pointer.move(page, {x: from.x, y: 8});
  await expect(labels.first()).toHaveValue(expected[0]);
  await pointer.up(page);

  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText(
    'レギュレーションを保存しました',
  );
  // The saved rows, then the blank one for adding another.
  await expect(labels).toHaveCount(expected.length + 1);
  for (const [index, label] of expected.entries()) {
    await expect(labels.nth(index)).toHaveValue(label);
  }
}

for (const [device, pointer, phone] of [
  ['a mouse', mouse, false],
  ['a finger', finger(), true],
] as const) {
  test.describe(`dragging with ${device}`, () => {
    if (phone) {
      test.use({hasTouch: true, viewport: {width: 390, height: 844}});
    }

    test('general staff reorder the tournaments', async ({page}) => {
      await openAsGeneralStaff(page, TOURNAMENT_ORDER_PATH);

      await swapTournaments(page, pointer, SHINJINOU.name, SAIKYOI.name);
      await swapTournaments(page, pointer, SAIKYOI.name, SHINJINOU.name);
    });

    test('general staff reorder a tournament’s regulations', async ({page}) => {
      await openAsGeneralStaff(page, SHINJINOU_REGULATIONS_PATH);
      const seeded = SHINJINOU.regulations.map(regulation => regulation.label);

      await swapRegulations(page, pointer, [...seeded].reverse());
      await swapRegulations(page, pointer, seeded);
    });
  });
}
