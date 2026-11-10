// 統括スタッフ → 地域の追加・編集
//
// This screen's two forms are SvelteKit remote functions (`form()` from
// `$app/server`, #376) rather than form actions, so what the component tests
// cannot show is checked here against the real thing: that a submission
// works with the client bundle and without it, that a refusal lands next to
// the control it is about with what was typed still there, and that typing
// before hydration survives it (#90).

import {expect, test, type Browser, type Page} from '@playwright/test';
import {GENERAL_STAFF, REGION} from '../support/fixtures';
import {createServiceRoleClient} from '../support/seed';
import {holdClientBundle, loginStaffThroughForm} from '../support/ui';

const REGIONS_PATH = '/admin/regions';

const SLUG_RULE_MESSAGE =
  'slug は英小文字で始まり、英小文字・数字・ハイフンのみで、2〜31 文字にしてください';

// `Checkbox.svelte` hides the real box and draws its own on top, so the box
// itself is never what a pointer lands on. The check goes to the box anyway.
const CHECKBOX_CLICK = {force: true};

let slugCount = 0;

/** A slug no other test in this run has used. */
function uniqueSlug(): string {
  slugCount += 1;
  return `e2e-region-${Date.now().toString(36)}-${slugCount}`;
}

/**
 * Opens the regions screen, signing in on the way.
 * @param page The page to drive.
 */
async function openRegions(page: Page): Promise<void> {
  await page.goto(REGIONS_PATH);
  await loginStaffThroughForm(page, GENERAL_STAFF);
  await expect(page.getByRole('heading', {name: '地域の管理'})).toBeVisible();
}

/**
 * A page that never runs the client bundle, already on the regions screen.
 * @param browser The browser to open it in.
 */
async function openRegionsWithoutJavaScript(browser: Browser): Promise<Page> {
  const context = await browser.newContext({javaScriptEnabled: false});
  const page = await context.newPage();
  await openRegions(page);
  return page;
}

/**
 * Lets the held client bundle through and waits for the page to hydrate.
 *
 * SvelteKit publishes no hydration signal, but Svelte's own hydration does:
 * it drops the `value` attribute from a bound input (the same signal
 * `entry-flow.spec.ts` waits for). The add form's slug is the input watched,
 * because the rows' inputs are handed a `defaultValue`, which puts the
 * attribute straight back. The attribute is checked to be there first, so
 * that its absence afterwards means something.
 *
 * Not `networkidle`: under `vite dev` it says only that the modules arrived,
 * and on a cold server it may not come at all.
 * @param page The page whose bundle was held, on the regions screen.
 * @param release What `holdClientBundle()` returned.
 */
async function releaseClientBundle(
  page: Page,
  release: () => void,
): Promise<void> {
  const slug = createForm(page).getByLabel('slug');
  await expect(slug).toHaveAttribute('value', '');
  release();
  await expect(slug).not.toHaveAttribute('value');
}

/**
 * Marks the document, so that `expectNoReload()` can tell whether it is
 * still the same one.
 * @param page The page to mark.
 */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.e2eMarked = 'true';
  });
}

/**
 * Checks that the document marked by `markDocument()` is still the one
 * showing: a form submitted by the client bundle leaves it in place, a
 * plain form post replaces it.
 * @param page The page that was marked.
 */
async function expectNoReload(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-e2e-marked', 'true');
}

/** The form that adds a region. */
function createForm(page: Page) {
  return page
    .locator('form')
    .filter({has: page.getByRole('button', {name: '追加'})});
}

/**
 * The card of one stored region, found by the slug it is headed with.
 * @param page The page to look on.
 * @param slug The region's slug.
 */
function rowOf(page: Page, slug: string) {
  return page
    .getByRole('listitem')
    .filter({has: page.getByRole('heading', {name: slug, exact: true})});
}

/**
 * Adds a region through the form and waits for its row.
 * @param page The page to drive, already on the regions screen.
 * @param slug The slug to give it.
 * @param name The name to give it.
 */
async function addRegion(
  page: Page,
  slug: string,
  name: string,
): Promise<void> {
  const form = createForm(page);
  await form.getByLabel('slug').fill(slug);
  await form.getByLabel('地域名').fill(name);
  await form.getByRole('button', {name: '追加'}).click();
  await expect(page.getByText('地域を追加しました')).toBeVisible();
  await expect(rowOf(page, slug)).toBeVisible();
}

// The specs after this one count on the seeded region alone, so every region
// added here is removed again, whichever test added it and however it ended.
test.afterAll(async () => {
  const {error} = await createServiceRoleClient()
    .from('regions')
    .delete()
    .neq('id', REGION.id);
  expect(error).toBeNull();
});

for (const javaScript of [true, false]) {
  const mode = javaScript ? 'JS あり' : 'JS なし';

  test.describe(mode, () => {
    let page: Page;

    test.beforeEach(async ({browser, page: defaultPage}) => {
      if (javaScript) {
        page = defaultPage;
        await openRegions(page);
      } else {
        page = await openRegionsWithoutJavaScript(browser);
      }
    });

    test.afterEach(async () => {
      if (!javaScript) await page.context().close();
    });

    test('地域を追加すると一覧に現れ、追加フォームは空に戻る', async () => {
      const slug = uniqueSlug();
      await addRegion(page, slug, '追加した地域');

      await expect(rowOf(page, slug).getByLabel('地域名')).toHaveValue(
        '追加した地域',
      );
      await expect(createForm(page).getByLabel('slug')).toHaveValue('');
      await expect(createForm(page).getByLabel('地域名')).toHaveValue('');
    });

    test('slug の形式が違うと、slug の欄にメッセージが出て入力は残る', async () => {
      const form = createForm(page);
      await form.getByLabel('slug').fill('Bad Slug');
      await form.getByLabel('地域名').fill('残る名前');
      await form.getByLabel('最強位と新人王の両方').check(CHECKBOX_CLICK);
      await form.getByRole('button', {name: '追加'}).click();

      await expect(form.getByText(SLUG_RULE_MESSAGE)).toBeVisible();
      await expect(page.getByText('入力内容を確認してください')).toBeVisible();
      await expect(form.getByLabel('slug')).toHaveValue('Bad Slug');
      await expect(form.getByLabel('slug')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(form.getByLabel('地域名')).toHaveValue('残る名前');
      await expect(form.getByLabel('最強位と新人王の両方')).toBeChecked();
    });

    test('使われている slug は API に断られ、slug の欄にメッセージが出る', async () => {
      const form = createForm(page);
      await form.getByLabel('slug').fill(REGION.slug);
      await form.getByLabel('地域名').fill('重複する地域');
      await form.getByRole('button', {name: '追加'}).click();

      await expect(
        form.getByText('この slug は既に使われています'),
      ).toBeVisible();
      await expect(form.getByLabel('slug')).toHaveValue(REGION.slug);
      await expect(form.getByLabel('地域名')).toHaveValue('重複する地域');
    });

    test('行を保存すると、その行にだけ結果が出て、保存した値が表示される', async () => {
      const slug = uniqueSlug();
      const other = uniqueSlug();
      await addRegion(page, slug, '変更前');
      await addRegion(page, other, '触らない地域');

      const row = rowOf(page, slug);
      await row.getByLabel('地域名').fill('変更後');
      await row.getByLabel('最強位と新人王の両方').check(CHECKBOX_CLICK);
      await row.getByRole('button', {name: '保存'}).click();

      await expect(row.getByText('保存しました')).toBeVisible();
      await expect(rowOf(page, other).getByText('保存しました')).toHaveCount(0);
      await expect(row.getByLabel('地域名')).toHaveValue('変更後');
      await expect(row.getByLabel('最強位と新人王の両方')).toBeChecked();

      await page.reload();
      await expect(rowOf(page, slug).getByLabel('地域名')).toHaveValue(
        '変更後',
      );
      await expect(
        rowOf(page, slug).getByLabel('最強位と新人王の両方'),
      ).toBeChecked();
    });

    test('行の地域名を空にすると、その行の欄にメッセージが出る', async () => {
      const slug = uniqueSlug();
      await addRegion(page, slug, '空にされる地域');

      const row = rowOf(page, slug);
      // Whitespace gets past the control's own `required`, which is what
      // would stop an empty value before it was ever submitted.
      await row.getByLabel('地域名').fill('   ');
      await row.getByRole('button', {name: '保存'}).click();

      await expect(row.getByText('地域名を入力してください')).toBeVisible();
      await expect(row.getByText('保存しました')).toHaveCount(0);
    });

    test('セッションが切れていると、戻り先つきでログイン画面に移る', async () => {
      await page.context().clearCookies();

      const form = createForm(page);
      await form.getByLabel('slug').fill(uniqueSlug());
      await form.getByLabel('地域名').fill('作られない地域');
      await form.getByRole('button', {name: '追加'}).click();

      await page.waitForURL(
        url =>
          url.pathname === '/staff/login' &&
          url.searchParams.get('redirectTo') === REGIONS_PATH,
      );
    });
  });
}

test.describe('ハイドレーションの前に入力した値', () => {
  test('ハイドレーションで消えず、そのまま保存される', async ({page}) => {
    await openRegions(page);
    const slug = uniqueSlug();
    await addRegion(page, slug, '保存済みの名前');

    const release = await holdClientBundle(page);
    await page.goto(REGIONS_PATH, {waitUntil: 'commit'});

    const form = createForm(page);
    await form.getByLabel('slug').fill('typed-early');
    await form.getByLabel('最強位と新人王の両方').check(CHECKBOX_CLICK);
    const row = rowOf(page, slug);
    await row.getByLabel('地域名').fill('早く打った名前');

    await releaseClientBundle(page, release);
    await markDocument(page);

    await expect(form.getByLabel('slug')).toHaveValue('typed-early');
    await expect(form.getByLabel('最強位と新人王の両方')).toBeChecked();
    await expect(row.getByLabel('地域名')).toHaveValue('早く打った名前');

    await row.getByRole('button', {name: '保存'}).click();
    await expect(row.getByText('保存しました')).toBeVisible();
    await expectNoReload(page);
    await page.reload();
    await expect(rowOf(page, slug).getByLabel('地域名')).toHaveValue(
      '早く打った名前',
    );
  });

  // A remote form only hears of input made after it hydrated, and renders
  // its controls again from what it heard when a submission is refused —
  // `adoptEarlyInput` is what keeps that from emptying them.
  test('ハイドレーション後の送信が断られても消えない', async ({page}) => {
    await openRegions(page);

    const release = await holdClientBundle(page);
    await page.goto(REGIONS_PATH, {waitUntil: 'commit'});

    const form = createForm(page);
    await form.getByLabel('slug').fill(REGION.slug);
    await form.getByLabel('地域名').fill('早く打った名前');
    await form.getByLabel('最強位と新人王の両方').check(CHECKBOX_CLICK);

    await releaseClientBundle(page, release);
    await markDocument(page);

    await form.getByRole('button', {name: '追加'}).click();

    await expect(
      form.getByText('この slug は既に使われています'),
    ).toBeVisible();
    await expectNoReload(page);
    await expect(form.getByLabel('slug')).toHaveValue(REGION.slug);
    await expect(form.getByLabel('地域名')).toHaveValue('早く打った名前');
    await expect(form.getByLabel('最強位と新人王の両方')).toBeChecked();
  });
});
