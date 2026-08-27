// The screens the three flows go through, addressed the way the people in
// those flows address them: by the labels, buttons and links the pages
// actually render, never by a CSS class or a test-only attribute.
//
// Paths are relative, so they resolve against `baseURL` — the `vite dev`
// server (see `playwright.config.ts`).

import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import {
  extractVerificationUrl,
  VERIFICATION_MAIL_SUBJECT,
  waitForMail,
} from './api';
import {
  formFieldDefsOf,
  PARTICIPANT_PASSWORD,
  REGION,
  uniqueEmail,
  type FormFieldDefFixture,
  type StaffFixture,
  type TournamentFixture,
} from './fixtures';

/** A participant's own view of their entries. */
const MYPAGE_PATH = '/mypage';

/** Matches `LOGIN_PATH` in `apps/frontend/src/lib/server/participant-session.ts`. */
const PARTICIPANT_LOGIN_PATH = '/mypage/login';

/** Matches `STAFF_LOGIN_PATH` in `apps/frontend/src/lib/server/staff-login.ts`. */
const STAFF_LOGIN_PATH = '/staff/login';

/** What a participant fills the entry form in with. */
export interface EntryFormInput {
  name?: string;
  furigana?: string;
  displayName?: string;
  email?: string;
  freeText?: string;
  /**
   * Answers to the tournament's custom fields, keyed by field key just as
   * `submitEntry()` in `./api.ts` keys them. Defaults to the tournament's
   * `defaultCustomFieldValues`, which satisfy its required fields.
   */
  customFieldValues?: Record<string, string | string[]>;
}

/** A participant the test created by filling the entry form in. */
export interface EntryFormParticipant {
  email: string;
  password: string;
  name: string;
  furigana: string;
  displayName: string;
}

/**
 * The entry form for one tournament.
 * @param tournament The tournament being entered.
 */
function entryFormPath(tournament: TournamentFixture): string {
  return `/${REGION.slug}/${tournament.type}/entry`;
}

/**
 * The public entry list for one tournament.
 * @param tournament The tournament whose list is wanted.
 */
export function entryListPath(tournament: TournamentFixture): string {
  return `/${REGION.slug}/${tournament.type}/list`;
}

/**
 * The staff-only roster for one tournament.
 * @param tournament The tournament whose roster is wanted.
 */
export function staffEntriesPath(tournament: TournamentFixture): string {
  return `/staff/${REGION.slug}/${tournament.type}/entries`;
}

/**
 * Waits for the client bundle to take over the server-rendered page.
 *
 * Every text input on these forms renders its value from a Svelte
 * expression (`value={form?.email ?? ''}` and the like), so hydration
 * assigns that expression — for a form nobody has submitted yet, the empty
 * string — over whatever the field happens to hold at that moment. Typing
 * before then is silently thrown away, and the submit that follows is then
 * blocked by the form's own `required` attributes.
 *
 * `networkidle` stands in for a hydration signal because SvelteKit exposes
 * none, and under `vite dev` the module graph the client bundle is
 * assembled from is exactly what the page is still fetching.
 * @param page The page to wait on.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

/**
 * Types into one field and checks that what was typed stayed there.
 *
 * The check is what keeps the hydration race described in
 * `waitForHydration()` legible: were the input ever lost again, this says so
 * at the field, instead of surfacing much later as a submit that did
 * nothing.
 * @param field The control to type into.
 * @param value The text to type.
 */
async function fillField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

/**
 * Fills the tournament's entry form in as a brand-new participant and
 * submits it.
 *
 * The entry is created `pending_verification`, so the form answers with the
 * "check your mail" notice rather than by navigating anywhere;
 * `openVerificationLink()` is what carries it on.
 * @param page The page to drive.
 * @param tournament The tournament being entered.
 * @param input Fields the spec wants to pin down; anything left out gets a
 *     filler value.
 */
export async function submitEntryForm(
  page: Page,
  tournament: TournamentFixture,
  input: EntryFormInput = {},
): Promise<EntryFormParticipant> {
  const participant: EntryFormParticipant = {
    email: input.email ?? uniqueEmail('participant'),
    password: PARTICIPANT_PASSWORD,
    name: input.name ?? 'テスト太郎',
    furigana: input.furigana ?? 'てすとたろう',
    displayName: input.displayName ?? 'テスト太郎',
  };

  await page.goto(entryFormPath(tournament));
  await expect(
    page.getByRole('heading', {name: `${tournament.name} へのエントリー`}),
  ).toBeVisible();
  await waitForHydration(page);

  await fillField(page.getByLabel('氏名', {exact: true}), participant.name);
  await fillField(
    page.getByLabel('ふりがな', {exact: true}),
    participant.furigana,
  );
  await fillField(
    page.getByLabel('掲載名', {exact: true}),
    participant.displayName,
  );
  await fillField(
    page.getByLabel('メールアドレス', {exact: true}),
    participant.email,
  );
  // Exact, or this would also match the confirmation field below it.
  await fillField(
    page.getByLabel('パスワード', {exact: true}),
    participant.password,
  );
  await fillField(
    page.getByLabel('パスワード(確認)', {exact: true}),
    participant.password,
  );

  await page
    .getByRole('group', {name: 'レギュレーションを選択してください'})
    .getByLabel(tournament.regulationLabel, {exact: true})
    .check();

  const answers =
    input.customFieldValues ?? tournament.defaultCustomFieldValues;
  for (const field of formFieldDefsOf(tournament)) {
    const answer = answers[field.fieldKey];
    // An optional field the spec didn't answer is simply left blank, the
    // same as a participant skipping it.
    if (answer !== undefined) {
      await answerCustomField(page, field, answer);
    }
  }

  if (input.freeText !== undefined) {
    await fillField(page.getByLabel('自由記述', {exact: true}), input.freeText);
  }

  await page.getByRole('button', {name: 'エントリーする'}).click();
  await expect(page.getByRole('status')).toContainText(participant.email);
  return participant;
}

/**
 * Answers one of a tournament's custom form fields.
 * @param page The page to drive.
 * @param field The field's seeded definition, which decides what control
 *     `DynamicFormField.svelte` rendered for it.
 * @param answer The answer to give.
 */
async function answerCustomField(
  page: Page,
  field: FormFieldDefFixture,
  answer: string | string[],
): Promise<void> {
  if (Array.isArray(answer)) {
    // Only a `checkbox` group takes several answers, and no fixture seeds
    // one, so filling it in has never been exercised. Adding a checkbox
    // field to `fixtures.ts` is what should bring the branch with it.
    throw new Error(
      `No seeded field type takes a list of answers, but ${field.fieldKey} ` +
        `was given ${JSON.stringify(answer)}.`,
    );
  }

  // Not `exact`, because a required field's label carries a trailing "*".
  switch (field.fieldType) {
    case 'textarea':
      await fillField(page.getByLabel(field.label), answer);
      return;
    case 'radio':
      await page
        .getByRole('group', {name: field.label})
        .getByLabel(answer, {exact: true})
        .check();
      return;
    default:
      throw new Error(
        `Answering a ${field.fieldType} field is not implemented; ` +
          `${field.fieldKey} needs one.`,
      );
  }
}

/**
 * Waits for a participant's confirmation mail and opens the link in it, the
 * way following it out of a mail client would.
 *
 * The link's origin is the `FRONTEND_URL` the backend was started with, so
 * it lands on the same `vite dev` server the rest of the flow is on.
 * @param page The page to open it in.
 * @param request An API context, used to read the mail stub.
 * @param email The address the confirmation mail went to.
 * @return The link that was opened, so a spec can follow it a second time.
 */
export async function openVerificationLink(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const mail = await waitForMail(request, email, VERIFICATION_MAIL_SUBJECT);
  const link = extractVerificationUrl(mail.html);
  await page.goto(link);
  return link;
}

/**
 * Signs a participant in and leaves them on mypage.
 *
 * Starts at `/mypage` rather than at the login form, because being bounced
 * there is how a participant reaches it: mypage is their own view, so an
 * anonymous visit is redirected rather than shown empty.
 * @param page The page to drive.
 * @param participant The participant to sign in as.
 */
export async function loginParticipantThroughForm(
  page: Page,
  participant: Pick<EntryFormParticipant, 'email' | 'password'>,
): Promise<void> {
  await page.goto(MYPAGE_PATH);
  await expect(page).toHaveURL(PARTICIPANT_LOGIN_PATH);
  await waitForHydration(page);

  await fillField(
    page.getByLabel('メールアドレス', {exact: true}),
    participant.email,
  );
  await fillField(
    page.getByLabel('パスワード', {exact: true}),
    participant.password,
  );
  await page.getByRole('button', {name: 'ログイン'}).click();
  await expect(page).toHaveURL(MYPAGE_PATH);
}

/**
 * Signs a staff member in from the login form the page is already showing.
 *
 * Where the login hands them next depends on the `redirectTo` the form was
 * reached with, so this only waits for the move off the form; the landing
 * page is the spec's assertion.
 * @param page The page to drive, already on the staff login form.
 * @param staff The staff account to sign in as.
 */
export async function loginStaffThroughForm(
  page: Page,
  staff: StaffFixture,
): Promise<void> {
  await expect(
    page.getByRole('heading', {name: 'スタッフログイン'}),
  ).toBeVisible();
  await waitForHydration(page);

  await fillField(page.getByLabel('メールアドレス'), staff.email);
  await fillField(page.getByLabel('パスワード'), staff.password);
  await page.getByRole('button', {name: 'ログイン'}).click();
  await page.waitForURL(url => !url.pathname.startsWith(STAFF_LOGIN_PATH));
}

/**
 * Cancels the one entry mypage is showing, accepting the confirmation
 * dialog it puts up first.
 *
 * Playwright dismisses dialogs unless a handler says otherwise, and the
 * page's `use:enhance` callback reads a dismissal as "don't cancel after
 * all" — so without the handler this would silently do nothing.
 * @param page The page to drive, already on mypage.
 */
export async function cancelEntryThroughMypage(page: Page): Promise<void> {
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'エントリーをキャンセルする'}).click();
}
