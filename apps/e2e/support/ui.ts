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
import {FRONTEND_URL} from './env';

/** A participant's own view of their entries. */
export const MYPAGE_PATH = '/mypage';

/** Matches `PARTICIPANT_LOGIN_PATH` in `apps/frontend/src/lib/server/participant-session.ts`. */
export const PARTICIPANT_LOGIN_PATH = '/mypage/login';

/** How long the Turnstile widget is given to produce its token. */
const TURNSTILE_TOKEN_TIMEOUT_MS = 20_000;

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
export function entryFormPath(tournament: TournamentFixture): string {
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
 * Holds back every module the client bundle is assembled from, so that a
 * spec can drive the server-rendered page before it has hydrated.
 *
 * This is what pins down #90 — where hydration overwrote every field
 * rendered from a `value={...}` expression — rather than leaving it to
 * whether the machine happened to be slow. Under `vite dev` the bundle is
 * an unbundled module graph served over HTTP, so withholding those
 * responses withholds hydration.
 *
 * `page.goto()` has to be given `waitUntil: 'commit'` while the hold is on:
 * the page's module scripts are what `load` and `domcontentloaded` wait for.
 * @param page The page to hold the bundle back on.
 * @return Releases the held modules, letting the page hydrate.
 */
export async function holdClientBundle(page: Page): Promise<() => void> {
  let release = (): void => {};
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(/\.(js|ts|svelte)(\?|$)/, async (route, request) => {
    // Only this app's own modules are held. Turnstile's `api.js` is served
    // from Cloudflare and is no part of the client bundle: holding it would
    // leave the form with no token to submit, which is a different failure
    // from the one these specs are about.
    //
    // Compared against `FRONTEND_URL` rather than `page.url()`, which is
    // still `about:blank` for the requests of the very navigation this hold
    // is set up for.
    if (!request.url().startsWith(FRONTEND_URL)) {
      await route.continue();
      return;
    }
    await released;
    await route.continue();
  });
  return release;
}

/**
 * Types into one field and checks that what was typed stayed there.
 *
 * The check is also what would catch a return of #90, where hydrating the
 * server-rendered page overwrote every field rendered from a `value={...}`
 * expression: nothing here waits for the client bundle to take over, so
 * these forms are filled in exactly as fast as Playwright can drive them.
 * @param field The control to type into.
 * @param value The text to type.
 */
async function fillField(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

/**
 * Fills in every control of the entry form the page is already showing, as
 * a brand-new participant, without submitting it.
 *
 * Split out from `submitEntryForm()` so a spec can drive the form while the
 * client bundle is held back (`holdClientBundle()`) — nothing here waits for
 * hydration, so it works against the server's HTML just as well.
 * @param page The page to drive, already on the entry form.
 * @param tournament The tournament being entered.
 * @param input Fields the spec wants to pin down; anything left out gets a
 *     filler value.
 * @return The participant the form was filled in as.
 */
export async function fillEntryForm(
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

  // Every one of them: an entry may claim several conditions, and the
  // specs assert that all of them come back out on the staff screens.
  const regulations = page.getByRole('group', {
    name: 'レギュレーションを選択してください',
  });
  for (const regulation of tournament.regulations) {
    await regulations.getByLabel(regulation.label, {exact: true}).check();
  }

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

  await waitForTurnstileToken(page);

  return participant;
}

/**
 * Waits for the Turnstile widget to have put its token in the form.
 *
 * Addressed by the control's name rather than by anything visible, because
 * the widget has nothing to address: with the testing site key it solves
 * itself and the participant never touches it. The name is Cloudflare's, and
 * is what `apps/frontend`'s form actions read the token out of.
 *
 * Submitting before it lands would be refused by the API as a missing token,
 * intermittently and for reasons that have nothing to do with the flow under
 * test.
 * @param page The page holding the form.
 */
async function waitForTurnstileToken(page: Page): Promise<void> {
  await expect(
    page.locator('input[name="cf-turnstile-response"]'),
    // Longer than the default: this waits on a third-party script being
    // fetched and run, which on a cold CI runner is not instant.
  ).not.toHaveValue('', {timeout: TURNSTILE_TOKEN_TIMEOUT_MS});
}

/**
 * Opens the tournament's entry form, fills it in as a brand-new
 * participant and submits it.
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
  await page.goto(entryFormPath(tournament));
  await expect(
    page.getByRole('heading', {name: `${tournament.name} へのエントリー`}),
  ).toBeVisible();

  const participant = await fillEntryForm(page, tournament, input);

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
  // Only a `checkbox` group offering options takes several answers; every
  // other control holds one.
  const options = Array.isArray(answer) ? answer : [answer];
  const isCheckboxGroup =
    field.fieldType === 'checkbox' && (field.options?.length ?? 0) > 0;
  if (!isCheckboxGroup && options.length !== 1) {
    throw new Error(
      `A ${field.fieldType} field holds one answer, but ${field.fieldKey} ` +
        `was given ${JSON.stringify(answer)}.`,
    );
  }

  // Not `exact` on the group's own label, because a required field's label
  // carries a trailing "*"; the options inside it are matched exactly.
  switch (field.fieldType) {
    case 'textarea':
      await fillField(page.getByLabel(field.label), options[0]);
      return;
    case 'radio':
      await page
        .getByRole('group', {name: field.label})
        .getByLabel(options[0], {exact: true})
        .check();
      return;
    case 'checkbox': {
      if (!isCheckboxGroup) {
        // A `checkbox` field with no options is a lone yes/no box labelled
        // by the field itself, not a group. No fixture seeds one, so how a
        // spec would say "check it" is left to whoever adds the first.
        throw new Error(
          `Answering the option-less checkbox ${field.fieldKey} is not ` +
            'implemented; no fixture seeds one.',
        );
      }
      const group = page.getByRole('group', {name: field.label});
      for (const option of options) {
        await group.getByLabel(option, {exact: true}).check();
      }
      return;
    }
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

/**
 * Ends the participant's session from the button the mypage layout carries.
 * @param page The page to drive, on any screen under `/mypage`.
 */
export async function logoutParticipantThroughButton(
  page: Page,
): Promise<void> {
  await page.getByRole('button', {name: 'ログアウト'}).click();
  await expect(page).toHaveURL(PARTICIPANT_LOGIN_PATH);
}
