// The API calls the specs still make directly, now that the three flows
// themselves are driven through the browser (`./ui.ts`).
//
// Three things are left here. The mail stub has no UI at all, and a
// participant's confirmation link only exists inside the mail it captured.
// `staff-csv.spec.ts` needs a roster to look at before it signs in; that
// arrangement is not what the spec is about, and the participant side of it
// is covered end-to-end by `entry-flow.spec.ts`. And the staff bulk send
// (Task 10-4) has no screen at all yet, so `staff-bulk-mail.spec.ts` drives
// its two endpoints directly -- what that spec is really about is the
// Cloudflare queue between them, which `wrangler dev` simulates locally.
//
// Every URL below names its origin in full, because the shared `request`
// fixture's `baseURL` is the *frontend* (see `playwright.config.ts`).

import {expect, type APIRequestContext} from '@playwright/test';
import type {
  EntryStatus,
  StaffMailJob,
  StaffMailInput,
  StaffMailResult,
} from '@regional-quiz/shared';
import {BACKEND_URL, FRONTEND_URL, MAIL_SINK_URL} from './env';
import {
  PARTICIPANT_PASSWORD,
  uniqueEmail,
  staffLoginScope,
  type StaffFixture,
  type TournamentFixture,
} from './fixtures';

/** One mail as `./mail-sink.ts` recorded it. */
export interface CapturedMail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  receivedAt: string;
}

/** A participant the test created with an entry. */
export interface EnteredParticipant {
  email: string;
  password: string;
  name: string;
  displayName: string;
}

/** The fields of an entry a spec may want to pin down. */
export interface EntryOverrides {
  name?: string;
  furigana?: string;
  displayName?: string;
  email?: string;
  freeText?: string;
  customFieldValues?: Record<string, string | string[]>;
}

// What `systemMailSubject()` prefixes every system mail's subject with
// (#170).
const SYSTEM_MAIL_SUBJECT_PREFIX = '【地域クイズ最強位・新人王】';

/**
 * The subject `sendVerificationEmail()` sends the confirmation link for
 * `tournament` under.
 * @param tournament The tournament being entered.
 */
export function verificationMailSubject(tournament: TournamentFixture): string {
  return `${SYSTEM_MAIL_SUBJECT_PREFIX}「${tournament.name}」のエントリーを確定してください`;
}

/**
 * The subject `sendEntryNoticeEmail()` tells an address's owner, instead of
 * the submitter, why an anonymous entry to `tournament` wasn't made (#117).
 * @param tournament The tournament the submission tried to enter.
 */
export function entryNoticeSubject(tournament: TournamentFixture): string {
  return `${SYSTEM_MAIL_SUBJECT_PREFIX}「${tournament.name}」へのエントリーを受け付けられませんでした`;
}

/**
 * The subject `promoteNextWaitlistedEntry()` tells a participant their
 * waitlisted entry to `tournament` was promoted under.
 * @param tournament The tournament the entry was waitlisted for.
 */
export function waitlistPromotionSubject(
  tournament: TournamentFixture,
): string {
  return `${SYSTEM_MAIL_SUBJECT_PREFIX}「${tournament.name}」のエントリーが確定しました(キャンセル待ちからの繰り上げ)`;
}

const MAIL_WAIT_TIMEOUT_MS = 10_000;
const MAIL_POLL_INTERVAL_MS = 100;

// Far longer than the mail wait above, because a bulk send is not made
// inside the request that asks for it: the messages sit in the queue until
// the consumer's batch fills or `max_batch_timeout` (5 seconds in
// `apps/backend/wrangler.toml`) expires, and the send is then paced.
const MAIL_JOB_TIMEOUT_MS = 30_000;

// The link `sendVerificationEmail()` builds, whose token is generated per
// request and stored only as a SHA-256 hash — so this mail body is the one
// place the raw token can be read from. Its origin is `FRONTEND_URL`, i.e.
// the `vite dev` server the browser is already on.
const VERIFICATION_LINK_PATTERN = /href="([^"]*\/verify\?token=[0-9a-f]+)"/;

/**
 * Submits an entry to `tournament` as a brand-new participant.
 *
 * The entry comes back `pending_verification`; `verifyEntry()` is what
 * moves it on.
 * @param request The API context to submit through.
 * @param tournament The tournament being entered.
 * @param overrides Entry fields the spec wants to pin down; anything left
 *     out gets a filler value.
 */
export async function submitEntry(
  request: APIRequestContext,
  tournament: TournamentFixture,
  overrides: EntryOverrides = {},
): Promise<EnteredParticipant> {
  const email = overrides.email ?? uniqueEmail('participant');
  const name = overrides.name ?? 'テスト太郎';
  const displayName = overrides.displayName ?? 'テスト太郎';
  const response = await request.post(
    `${BACKEND_URL}/api/tournaments/${tournament.id}/entries`,
    {
      // The Turnstile token the browser would have sent. The run's secret
      // key accepts any token (`./env.ts`), so an arrangement call that
      // never opens a browser can name one and be believed; without it the
      // endpoint refuses the entry outright (#116).
      headers: {'cf-turnstile-response': 'e2e-turnstile-token'},
      data: {
        name,
        furigana: overrides.furigana ?? 'てすとたろう',
        displayName,
        email,
        password: PARTICIPANT_PASSWORD,
        passwordConfirm: PARTICIPANT_PASSWORD,
        regulationIds: tournament.regulations.map(r => r.id),
        freeText: overrides.freeText,
        customFieldValues:
          overrides.customFieldValues ?? tournament.defaultCustomFieldValues,
      },
    },
  );
  // Answered before the entry is made, and the same whatever the address
  // (#117): the account and the entry are created after the response, in
  // `waitUntil()`. The confirmation mail is the last thing that work does,
  // so waiting for it is what makes the entry safe for the spec to rely on.
  expect(response.status(), await response.text()).toBe(202);
  await waitForMail(request, email, verificationMailSubject(tournament));
  return {
    email,
    password: PARTICIPANT_PASSWORD,
    name,
    displayName,
  };
}

/**
 * Reads the mail the stub captured for one address, newest first.
 * @param request The API context to read through.
 * @param to The recipient address to filter on.
 */
export async function readMails(
  request: APIRequestContext,
  to: string,
): Promise<CapturedMail[]> {
  const response = await request.get(
    `${MAIL_SINK_URL}/messages?to=${encodeURIComponent(to)}`,
  );
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {messages: CapturedMail[]};
  return body.messages;
}

/**
 * Waits for a mail to reach the stub.
 *
 * Mail is not always sent inside the request that causes it: an anonymous
 * entry is answered first and its mail sent afterwards, in `waitUntil()`
 * (#117). So this polls, which also keeps a slow machine from turning into a
 * flaky failure.
 * @param request The API context to read through.
 * @param to The recipient address to wait for.
 * @param subject The exact subject to wait for. Omit to take whichever
 *     mail arrived most recently.
 */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  subject?: string,
): Promise<CapturedMail> {
  const deadline = Date.now() + MAIL_WAIT_TIMEOUT_MS;
  for (;;) {
    const mails = await readMails(request, to);
    const match =
      subject === undefined
        ? mails[0]
        : mails.find(mail => mail.subject === subject);
    if (match) {
      return match;
    }
    if (Date.now() >= deadline) {
      const described = subject === undefined ? '' : ` with subject ${subject}`;
      throw new Error(
        `No mail to ${to}${described} arrived within ` +
          `${MAIL_WAIT_TIMEOUT_MS}ms (${mails.length} other mails to that ` +
          'address were captured).',
      );
    }
    await new Promise(resolve => setTimeout(resolve, MAIL_POLL_INTERVAL_MS));
  }
}

/**
 * Pulls the confirmation link out of a confirmation mail.
 * @param html The mail body.
 * @return The link's `href`, ready to be opened with `page.goto()`.
 */
export function extractVerificationUrl(html: string): string {
  const match = VERIFICATION_LINK_PATTERN.exec(html);
  if (!match) {
    throw new Error(`No verification link in the mail body: ${html}`);
  }
  return match[1];
}

/**
 * Waits for a participant's confirmation mail and hands its token to the
 * API, confirming the entry.
 *
 * Only the arrangement in `staff-csv.spec.ts` uses this; the flow of
 * following the link in a browser is `followVerificationLink()` in `./ui.ts`.
 * @param request The API context to confirm through.
 * @param tournament The tournament the entry was made to.
 * @param email The address the confirmation mail went to.
 * @return The status the entry landed in: `confirmed` when the tournament
 *     had a free seat, `waitlisted` when it did not.
 */
export async function verifyEntry(
  request: APIRequestContext,
  tournament: TournamentFixture,
  email: string,
): Promise<EntryStatus> {
  const mail = await waitForMail(
    request,
    email,
    verificationMailSubject(tournament),
  );
  const {searchParams} = new URL(extractVerificationUrl(mail.html));
  const token = searchParams.get('token');
  expect(token, 'the verification link carries no token').toBeTruthy();
  // A POST, like the `/verify` page's confirm button sends (#190).
  const response = await request.post(`${BACKEND_URL}/api/entries/verify`, {
    data: {token},
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {status: EntryStatus};
  return body.status;
}

/**
 * Enters `tournament` as a new participant and confirms the entry.
 * @param request The API context to act through.
 * @param tournament The tournament being entered.
 * @param overrides Entry fields the spec wants to pin down.
 */
export async function enterAndVerify(
  request: APIRequestContext,
  tournament: TournamentFixture,
  overrides: EntryOverrides = {},
): Promise<EnteredParticipant & {status: EntryStatus}> {
  const participant = await submitEntry(request, tournament, overrides);
  const status = await verifyEntry(request, tournament, participant.email);
  return {...participant, status};
}

/**
 * Signs a staff account in, leaving the session cookie in `request`'s own
 * jar so the calls after it are authenticated.
 *
 * The browser-driven version of this is `loginStaffThroughForm()` in
 * `./ui.ts`; this exists for the bulk send, which has no screen to sign in
 * from.
 * @param request The API context to sign in through.
 * @param staff The account to sign in as.
 */
export async function loginStaff(
  request: APIRequestContext,
  staff: StaffFixture,
): Promise<void> {
  const response = await request.post(`${BACKEND_URL}/api/auth/staff/login`, {
    data: {
      email: staff.email,
      scope: staffLoginScope(staff),
      password: staff.password,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * Asks for a bulk send to the entries of `tournamentId`, as the signed-in
 * staff member: the confirmed and waitlisted ones, unless `mail.statusFilter`
 * names another status.
 *
 * Answers as soon as the recipients are enqueued: what it returns is the
 * job to watch, not a delivery report.
 * @param request The API context, already holding a staff session.
 * @param tournamentId The tournament whose entries to mail.
 * @param mail The subject, HTML body and optional status filter to send.
 */
export async function sendBulkMail(
  request: APIRequestContext,
  tournamentId: string,
  mail: StaffMailInput,
): Promise<StaffMailResult> {
  const response = await request.post(
    `${BACKEND_URL}/api/staff/tournaments/${tournamentId}/mail`,
    {data: mail},
  );
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()) as StaffMailResult;
}

/**
 * Asks for the confirmation mail to be sent again to the unconfirmed
 * entries of `tournamentId` whose link has run out, as the signed-in staff
 * member (#192).
 *
 * Answers as soon as the entries are enqueued, like `sendBulkMail()`.
 * @param request The API context, already holding a staff session.
 * @param tournamentId The tournament whose entries to remind.
 */
export async function resendVerificationMail(
  request: APIRequestContext,
  tournamentId: string,
): Promise<StaffMailResult> {
  const response = await request.post(
    `${BACKEND_URL}/api/staff/tournaments/${tournamentId}/verification-mail`,
    // There is no body, so the origin is what tells `hono/csrf` this is
    // not a form posted from a foreign page -- as a browser would send it.
    {headers: {origin: FRONTEND_URL}},
  );
  expect(response.status(), await response.text()).toBe(202);
  return (await response.json()) as StaffMailResult;
}

/**
 * Waits for a bulk send to finish, i.e. for the queue's consumer to have
 * settled every recipient it was given.
 *
 * The wait is what makes this an end-to-end check of the queue: the
 * request that started the send only enqueued the addresses, so the
 * counters can only move if the consumer ran.
 * @param request The API context, already holding a staff session.
 * @param tournamentId The tournament the job belongs to.
 * @param jobId The job to watch.
 */
export async function waitForMailJob(
  request: APIRequestContext,
  tournamentId: string,
  jobId: string,
): Promise<StaffMailJob> {
  const deadline = Date.now() + MAIL_JOB_TIMEOUT_MS;
  for (;;) {
    const response = await request.get(
      `${BACKEND_URL}/api/staff/tournaments/${tournamentId}/mail/${jobId}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const job = (await response.json()) as StaffMailJob;
    if (job.sent + job.failed >= job.total) {
      return job;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Mail job ${jobId} settled ${job.sent + job.failed} of ${job.total} ` +
          `recipients within ${MAIL_JOB_TIMEOUT_MS}ms.`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, MAIL_POLL_INTERVAL_MS));
  }
}
