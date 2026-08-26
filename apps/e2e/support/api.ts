// The steps the specs share, expressed once. Each one drives the real HTTP
// API on `apps/backend`; nothing here reaches into the database, so a step
// that the API would refuse fails here too.

import {
  expect,
  type APIRequestContext,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import type {EntryStatus} from '@regional-quiz/shared';
import {BACKEND_URL, MAIL_SINK_URL} from './env';
import {
  PARTICIPANT_PASSWORD,
  uniqueEmail,
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

/** A participant the test created, and the entry they created it with. */
export interface EnteredParticipant {
  email: string;
  password: string;
  entryId: string;
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

const MAIL_WAIT_TIMEOUT_MS = 10_000;
const MAIL_POLL_INTERVAL_MS = 100;

// The link `sendVerificationEmail()` builds, whose token is generated per
// request and stored only as a SHA-256 hash — so this mail body is the one
// place the raw token can be read from.
const VERIFICATION_LINK_PATTERN = /\/verify\?token=([0-9a-f]+)/;

/**
 * Opens an API context of its own, pointed at the same backend as the
 * shared `request` fixture.
 *
 * That fixture has a single cookie jar, so a spec that needs two sessions
 * at once — two participants, or a participant and a staff member — needs
 * a second context rather than a second login.
 * @param playwright The `playwright` fixture.
 */
export async function newApiContext(
  playwright: PlaywrightWorkerArgs['playwright'],
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: BACKEND_URL,
    ignoreHTTPSErrors: true,
  });
}

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
    `/api/tournaments/${tournament.id}/entries`,
    {
      data: {
        name,
        furigana: overrides.furigana ?? 'てすとたろう',
        displayName,
        email,
        password: PARTICIPANT_PASSWORD,
        passwordConfirm: PARTICIPANT_PASSWORD,
        regulationId: tournament.regulationId,
        freeText: overrides.freeText,
        customFieldValues:
          overrides.customFieldValues ?? tournament.defaultCustomFieldValues,
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
  const entry = (await response.json()) as {id: string};
  return {
    email,
    password: PARTICIPANT_PASSWORD,
    entryId: entry.id,
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
 * Every send the specs trigger is awaited inside the request that causes
 * it, so this normally succeeds on the first read; the polling is only
 * there so a slow machine doesn't turn into a flaky failure.
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
 * Pulls the one-time token out of a confirmation mail's link.
 * @param html The mail body.
 */
export function extractVerificationToken(html: string): string {
  const match = VERIFICATION_LINK_PATTERN.exec(html);
  if (!match) {
    throw new Error(`No verification link in the mail body: ${html}`);
  }
  return match[1];
}

/**
 * Waits for a participant's confirmation mail and follows the link in it,
 * confirming the entry.
 *
 * The link points at a frontend page that does not exist yet (see #72), so
 * the token is handed to the API the page would call.
 * @param request The API context to confirm through.
 * @param email The address the confirmation mail went to.
 * @returns The status the entry landed in: `confirmed` when the tournament
 *     had a free seat, `waitlisted` when it did not.
 */
export async function verifyEntry(
  request: APIRequestContext,
  email: string,
): Promise<EntryStatus> {
  const mail = await waitForMail(request, email, 'エントリー確認メール');
  const token = extractVerificationToken(mail.html);
  const response = await request.get(`/api/entries/verify?token=${token}`);
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
  const status = await verifyEntry(request, participant.email);
  return {...participant, status};
}

/**
 * Logs a participant in, leaving the session cookie in `request`'s jar.
 * @param request The API context to log in through, and to carry the
 *     resulting session.
 * @param participant The participant to log in as.
 */
export async function loginParticipant(
  request: APIRequestContext,
  participant: Pick<EnteredParticipant, 'email' | 'password'>,
): Promise<void> {
  const response = await request.post('/api/auth/participant/login', {
    data: {email: participant.email, password: participant.password},
  });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * Logs a staff member in, leaving the session cookie in `request`'s jar.
 * @param request The API context to log in through, and to carry the
 *     resulting session.
 * @param staff The staff account to log in as.
 */
export async function loginStaff(
  request: APIRequestContext,
  staff: StaffFixture,
): Promise<void> {
  const response = await request.post('/api/auth/staff/login', {
    data: {email: staff.email, password: staff.password},
  });
  expect(response.status(), await response.text()).toBe(200);
  expect(await response.json()).toMatchObject({ok: true, role: staff.role});
}

/** One entry as `GET /api/mypage/entries` reports it. */
export interface MypageEntryResponse {
  id: string;
  tournamentId: string;
  status: EntryStatus;
  waitlistPosition: number | null;
  tournament: {name: string; type: string};
}

/**
 * Reads the logged-in participant's own entries.
 * @param request An API context carrying a participant session.
 */
export async function readMypageEntries(
  request: APIRequestContext,
): Promise<MypageEntryResponse[]> {
  const response = await request.get('/api/mypage/entries');
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MypageEntryResponse[];
}
