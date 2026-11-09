import {afterAll, afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {
  allowingRateLimiter,
  refusingRateLimiter,
  testBindings,
} from '../test-support/bindings';
import {
  DB_URL,
  isDbReachable,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
} from '../test-support/db';
import {
  createEntryRow,
  createTournamentAndRegulation,
  deleteTestRegionRows,
} from '../test-support/db-fixtures';
import {MAIL_QUEUE_MAX_ATTEMPTS, handleBulkMailQueue} from './bulk-mail-queue';
import {
  ENTRY_MAIL_DEFER_SECONDS,
  isDeferredEntryMail,
  type DeferredEntryMailMessage,
} from './deferred-entry-mail';
import {entryNoticeSubject} from './entry-notice';
import {holdForDeferredVerification} from './entry-verification';

class FakeMessage implements Message<DeferredEntryMailMessage> {
  readonly id = `message-${crypto.randomUUID()}`;
  readonly timestamp = new Date();
  acked = false;
  retriedWith: QueueRetryOptions | undefined | 'not retried' = 'not retried';

  constructor(
    readonly body: DeferredEntryMailMessage,
    readonly attempts = 1,
  ) {}

  ack(): void {
    this.acked = true;
  }

  retry(options?: QueueRetryOptions): void {
    this.retriedWith = options;
  }
}

function batchOf(
  messages: FakeMessage[],
): MessageBatch<DeferredEntryMailMessage> {
  return {
    queue: 'regional-quiz-bulk-mail-test',
    messages,
    metadata: {metrics: {backlogCount: 0, backlogBytes: 0}},
    retryAll: () => {},
    ackAll: () => {},
  };
}

describe('isDeferredEntryMail', () => {
  it('tells the deferred entry mails from the job messages', () => {
    expect(
      isDeferredEntryMail({
        kind: 'deferred-notice',
        to: 'a@example.com',
        tournamentName: '大会',
        reason: 'already-entered',
      }),
    ).toBe(true);
    expect(isDeferredEntryMail({jobId: 'j', to: 'a@example.com'})).toBe(false);
    expect(isDeferredEntryMail({jobId: 'j', entryId: 'e'})).toBe(false);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'handleBulkMailQueue with deferred entry mail (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const regionSlug = `deferred-mail-${crypto.randomUUID().slice(0, 8)}`;
    const emailDomain = 'deferred-mail-test.example.com';
    const originalFetch = globalThis.fetch;
    let suffix = 0;
    let mails: Array<{to: string[] | string; subject: string; html: string}>;
    /** The status the next Resend call answers with. */
    let resendStatus: number;

    function envWith(limiter = allowingRateLimiter()) {
      return testBindings({
        SUPABASE_URL,
        SUPABASE_SECRET_KEY,
        MAIL_TRIGGER_EMAIL_RATE_LIMITER: limiter,
      });
    }

    beforeEach(() => {
      mails = [];
      resendStatus = 200;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          mails.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            new Response(JSON.stringify({id: 'mail'}), {status: resendStatus}),
          );
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    afterAll(async () => {
      await deleteTestRegionRows(sql, regionSlug, emailDomain);
      await sql.close();
    });

    /** A pending entry held for its deferred mail, as the route leaves it. */
    async function deferredEntry() {
      suffix += 1;
      const fixture = await createTournamentAndRegulation(
        sql,
        `${regionSlug}-${suffix}`,
      );
      const {entryId, participantId} = await createEntryRow(
        sql,
        fixture,
        emailDomain,
      );
      await holdForDeferredVerification(envWith(), entryId);
      const [{email}] = await sql`
        select email from participants where id = ${participantId}
      `;
      return {entryId, email: email as string};
    }

    async function liveTokens(entryId: string): Promise<number> {
      const [{count}] = await sql`
        select count(*)::int as count from email_verification_tokens
        where entry_id = ${entryId} and used_at is null and expires_at >= now()
      `;
      return count as number;
    }

    it('holds the entry with a token that is already expired', async () => {
      const {entryId} = await deferredEntry();

      const [{count}] = await sql`
        select count(*)::int as count from email_verification_tokens
        where entry_id = ${entryId}
      `;
      expect(count).toBe(1);
      expect(await liveTokens(entryId)).toBe(0);
    });

    // If the deferred mail is never sent, the owner's next submission lapses
    // the entry (as it does one whose link expired) instead of telling them
    // to wait for a link that is not coming.
    it('leaves an entry whose mail was lost to lapse on the next submission', async () => {
      const {entryId} = await deferredEntry();
      const [{participant_id: participantId}] = await sql`
        select participant_id from entries where id = ${entryId}
      `;

      await sql`select lapse_expired_pending_entries(${participantId})`;

      const [{status}] =
        await sql`select status from entries where id = ${entryId}`;
      expect(status).toBe('cancelled');
    });

    it('issues the link and mails it when the entry still needs it', async () => {
      const {entryId, email} = await deferredEntry();
      const message = new FakeMessage({
        kind: 'deferred-verification',
        entryId,
        to: email,
        withdrawnTournaments: ['別の大会'],
      });

      await handleBulkMailQueue(batchOf([message]), envWith());

      expect(message.acked).toBe(true);
      expect(mails).toHaveLength(1);
      expect(mails[0].html).toContain('/verify?token=');
      expect(mails[0].html).toContain('別の大会');
      expect(await liveTokens(entryId)).toBe(1);
    });

    // What coalesces a flood: every new submission under an unverified
    // address deletes the entries the earlier ones made.
    it('sends nothing for an entry a later submission replaced', async () => {
      const {entryId, email} = await deferredEntry();
      await sql`delete from email_verification_tokens where entry_id = ${entryId}`;
      await sql`delete from entries where id = ${entryId}`;
      const message = new FakeMessage({
        kind: 'deferred-verification',
        entryId,
        to: email,
      });

      await handleBulkMailQueue(batchOf([message]), envWith());

      expect(message.acked).toBe(true);
      expect(mails).toEqual([]);
    });

    it('waits while the address is over its limit, without leaving a live link', async () => {
      const {entryId, email} = await deferredEntry();
      const message = new FakeMessage({
        kind: 'deferred-verification',
        entryId,
        to: email,
      });

      await handleBulkMailQueue(
        batchOf([message]),
        envWith(refusingRateLimiter()),
      );

      expect(message.retriedWith).toEqual({
        delaySeconds: ENTRY_MAIL_DEFER_SECONDS,
      });
      expect(mails).toEqual([]);
      // The link issued for the attempt was thrown away, so the next one
      // still finds the entry in need of one.
      expect(await liveTokens(entryId)).toBe(0);
    });

    it('gives up on the last attempt rather than handing it to the dead letter queue', async () => {
      const {entryId, email} = await deferredEntry();
      const message = new FakeMessage(
        {kind: 'deferred-verification', entryId, to: email},
        MAIL_QUEUE_MAX_ATTEMPTS,
      );
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        await handleBulkMailQueue(
          batchOf([message]),
          envWith(refusingRateLimiter()),
        );
      } finally {
        console.error = originalConsoleError;
      }

      expect(message.acked).toBe(true);
      expect(message.retriedWith).toBe('not retried');
    });

    it('sends a deferred notice, and retries one the provider failed for now', async () => {
      const notice: DeferredEntryMailMessage = {
        kind: 'deferred-notice',
        to: `notice@${emailDomain}`,
        tournamentName: 'テスト大会',
        reason: 'password-mismatch',
      };
      const sent = new FakeMessage(notice);
      await handleBulkMailQueue(batchOf([sent]), envWith());

      resendStatus = 503;
      const failed = new FakeMessage(notice);
      await handleBulkMailQueue(batchOf([failed]), envWith());

      expect(sent.acked).toBe(true);
      expect(mails[0].subject).toBe(entryNoticeSubject('テスト大会'));
      expect(mails[0].html).toContain('パスワード');
      expect(failed.acked).toBe(false);
      expect(failed.retriedWith).toEqual({
        delaySeconds: ENTRY_MAIL_DEFER_SECONDS,
      });
    });
  },
);
