import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {confirmPasswordReset, requestPasswordReset} from './password-reset';
import {hashPassword, verifyPassword} from './password';
import {generateToken, hashToken} from './token';

// Local Supabase Postgres connection (`supabase start` default), same
// convention as `lib/db-schema.test.ts`. Skipped automatically when one
// isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack,
// same as `lib/entries.test.ts` — not a real credential.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function isDbReachable(): Promise<boolean> {
  const probe = new SQL(DB_URL);
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const env: Bindings = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

interface SentMail {
  to: string;
  html: string;
}

describe.skipIf(!(await isDbReachable()))(
  'password reset (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'password-reset-test-region';
    const testEmailDomain = 'password-reset-test.example.com';
    const originalFetch = globalThis.fetch;
    const sentMails: SentMail[] = [];
    let regionId: string;

    beforeAll(async () => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          const body = JSON.parse(String(init?.body)) as SentMail;
          sentMails.push({to: body.to, html: body.html});
          return new Response(null, {status: 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;

      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug}, 'テスト地域')
        returning id
      `;
      regionId = region.id as string;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await sql`delete from password_reset_tokens where participant_id in (
        select id from participants where email like ${'%@' + testEmailDomain}
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from regions where slug = ${testRegionSlug}`;
      await sql.close();
    });

    async function createParticipantFixture(
      password = 'original-password',
    ): Promise<{id: string; email: string}> {
      const email = `participant-${crypto.randomUUID()}@${testEmailDomain}`;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${regionId}, ${email}, ${await hashPassword(password)})
        returning id
      `;
      return {id: participant.id as string, email};
    }

    async function createTokenFixture(
      participantId: string,
      options: {expiresAt?: string; used?: boolean} = {},
    ): Promise<string> {
      const token = generateToken();
      await sql`
        insert into password_reset_tokens (
          participant_id, token_hash, expires_at, used_at
        ) values (
          ${participantId}, ${await hashToken(token)},
          ${options.expiresAt ?? '2099-01-01T00:00:00Z'},
          ${options.used ? '2020-01-01T00:00:00Z' : null}
        )
      `;
      return token;
    }

    async function readPasswordHash(participantId: string): Promise<string> {
      const [row] = await sql`
        select password_hash from participants where id = ${participantId}
      `;
      return row.password_hash as string;
    }

    it('requestPasswordReset mails a usable link for a registered email', async () => {
      const participant = await createParticipantFixture();
      const mailsBefore = sentMails.length;

      await requestPasswordReset(env, participant.email);

      expect(sentMails.length).toBe(mailsBefore + 1);
      const mail = sentMails[sentMails.length - 1];
      expect(mail.to).toBe(participant.email);
      const token = mail.html.match(/password-reset\?token=([0-9a-f]+)/)?.[1];
      expect(token).toBeDefined();

      // Stored hashed, never in the clear: the raw token only ever exists in
      // the recipient's mailbox.
      const [tokenRow] = await sql`
        select token_hash, expires_at, used_at from password_reset_tokens
        where participant_id = ${participant.id}
      `;
      expect(tokenRow.token_hash).toBe(await hashToken(token as string));
      expect(tokenRow.used_at).toBeNull();
      expect(new Date(tokenRow.expires_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('requestPasswordReset always returns ok regardless of whether the email exists', async () => {
      const mailsBefore = sentMails.length;

      const result = await requestPasswordReset(
        env,
        `unknown-${crypto.randomUUID()}@${testEmailDomain}`,
      );

      // Indistinguishable from the registered-email case above from the
      // caller's side, but nothing is issued or sent.
      expect(result).toBeUndefined();
      expect(sentMails.length).toBe(mailsBefore);
    });

    it('confirmPasswordReset updates the password with a valid token', async () => {
      const participant = await createParticipantFixture();
      const token = await createTokenFixture(participant.id);

      const result = await confirmPasswordReset(env, {
        token,
        newPassword: 'brand-new-password',
      });

      expect(result).toEqual({ok: true});
      const passwordHash = await readPasswordHash(participant.id);
      expect(await verifyPassword('brand-new-password', passwordHash)).toBe(
        true,
      );
      expect(await verifyPassword('original-password', passwordHash)).toBe(
        false,
      );
      const [tokenRow] = await sql`
        select used_at from password_reset_tokens
        where participant_id = ${participant.id}
      `;
      expect(tokenRow.used_at).not.toBeNull();
    });

    it('confirmPasswordReset moves password_changed_at, cutting existing sessions', async () => {
      const participant = await createParticipantFixture();
      const token = await createTokenFixture(participant.id);
      const [before] = await sql`
        select password_changed_at from participants where id = ${participant.id}
      `;

      expect(
        await confirmPasswordReset(env, {
          token,
          newPassword: 'brand-new-password',
        }),
      ).toEqual({ok: true});

      // Participant sessions are stateless week-long JWTs carrying this value
      // as `pwdChangedAt`; `requireParticipant()` refuses any that no longer
      // match. If the reset left the column alone, a stolen cookie would
      // outlive the reset meant to revoke it.
      const [after] = await sql`
        select password_changed_at from participants where id = ${participant.id}
      `;
      expect(new Date(after.password_changed_at).getTime()).toBeGreaterThan(
        new Date(before.password_changed_at).getTime(),
      );
    });

    it('requestPasswordReset drops the participant’s expired tokens', async () => {
      const participant = await createParticipantFixture();
      const expired = await createTokenFixture(participant.id, {
        expiresAt: '2020-01-01T00:00:00Z',
      });
      const live = await createTokenFixture(participant.id);

      await requestPasswordReset(env, participant.email);

      // `/request` is unauthenticated and unthrottled, so without this the
      // table grows a row per call forever. Only rows that were already
      // refused for being expired go: the still-usable link stays.
      const remaining = await sql`
        select token_hash from password_reset_tokens
        where participant_id = ${participant.id}
      `;
      const hashes = remaining.map((row: {token_hash: string}) =>
        String(row.token_hash),
      );
      expect(hashes).not.toContain(await hashToken(expired));
      expect(hashes).toContain(await hashToken(live));
      // The freshly issued one is there too.
      expect(hashes.length).toBe(2);
    });

    it('confirmPasswordReset rejects a reused token', async () => {
      const participant = await createParticipantFixture();
      const token = await createTokenFixture(participant.id);

      expect(
        await confirmPasswordReset(env, {token, newPassword: 'first-password'}),
      ).toEqual({ok: true});

      const result = await confirmPasswordReset(env, {
        token,
        newPassword: 'second-password',
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'invalid or expired token',
      });
      // The second attempt left the password from the first one in place.
      const passwordHash = await readPasswordHash(participant.id);
      expect(await verifyPassword('first-password', passwordHash)).toBe(true);
      expect(await verifyPassword('second-password', passwordHash)).toBe(false);
    });

    it('confirmPasswordReset rejects an expired token', async () => {
      const participant = await createParticipantFixture();
      const token = await createTokenFixture(participant.id, {
        expiresAt: '2020-01-01T00:00:00Z',
      });

      const result = await confirmPasswordReset(env, {
        token,
        newPassword: 'brand-new-password',
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'invalid or expired token',
      });
      expect(
        await verifyPassword(
          'original-password',
          await readPasswordHash(participant.id),
        ),
      ).toBe(true);
    });

    it('confirmPasswordReset rejects an unknown token', async () => {
      const result = await confirmPasswordReset(env, {
        token: generateToken(),
        newPassword: 'brand-new-password',
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'invalid or expired token',
      });
    });

    it('confirmPasswordReset lets only one of two concurrent distinct tokens through', async () => {
      const participant = await createParticipantFixture();
      const firstToken = await createTokenFixture(participant.id);
      const secondToken = await createTokenFixture(participant.id);

      // Two links the participant requested one after the other, clicked at
      // the same moment. `reset_participant_password` locks the participant
      // row before either token row, so these queue up instead of each
      // holding the token row the other one has to burn -- which used to
      // deadlock and cost one of them a 500 -- and the loser observes the
      // `used_at` the winner set.
      const results = await Promise.all([
        confirmPasswordReset(env, {
          token: firstToken,
          newPassword: 'first-password',
        }),
        confirmPasswordReset(env, {
          token: secondToken,
          newPassword: 'second-password',
        }),
      ]);

      const succeeded = results.filter(result => result.ok);
      expect(succeeded.length).toBe(1);
      expect(results.filter(result => !result.ok)).toEqual([
        {ok: false, status: 400, error: 'invalid or expired token'},
      ]);

      // Exactly one of the two new passwords is in place -- never a mix
      // where the rejected request still overwrote the accepted one.
      const passwordHash = await readPasswordHash(participant.id);
      const winnerIsFirst = results[0].ok;
      expect(
        await verifyPassword(
          winnerIsFirst ? 'first-password' : 'second-password',
          passwordHash,
        ),
      ).toBe(true);
      expect(
        await verifyPassword(
          winnerIsFirst ? 'second-password' : 'first-password',
          passwordHash,
        ),
      ).toBe(false);

      // Both links are spent either way.
      const tokenRows = await sql`
        select used_at from password_reset_tokens
        where participant_id = ${participant.id}
      `;
      expect(tokenRows.length).toBe(2);
      for (const row of tokenRows) {
        expect(row.used_at).not.toBeNull();
      }
    });

    it('reset_participant_password serializes two distinct tokens for the same participant', async () => {
      // Driven against the function rather than through
      // `confirmPasswordReset`, which cannot provoke this on its own:
      // hashing the new password takes long enough that two calls started
      // together still reach the database milliseconds apart, while the
      // window being guarded here is a single statement wide. Two
      // connections, so the two calls really are in flight at once, and a
      // handful of rounds because the interleaving is up to the scheduler.
      //
      // Before the participant row was locked first, each call locked only
      // its own token and then went after the shared `participants` row and
      // the other call's token, so the two ended up waiting on each other
      // and Postgres aborted one with a deadlock -- a 500 for a participant
      // whose reset link was perfectly valid.
      const connections = [new SQL(DB_URL), new SQL(DB_URL)];
      try {
        for (let round = 0; round < 10; round++) {
          const participant = await createParticipantFixture();
          const tokenHashes = await Promise.all(
            [
              await createTokenFixture(participant.id),
              await createTokenFixture(participant.id),
            ].map(hashToken),
          );

          const outcomes = await Promise.allSettled(
            tokenHashes.map(
              (tokenHash, index) =>
                connections[
                  index
                ]`select reset_participant_password(${tokenHash}, ${`password-hash-${index}`})`,
            ),
          );

          // One reset goes through and the other is refused as already
          // used. Neither is ever refused for having lost a deadlock.
          expect(
            outcomes.filter(outcome => outcome.status === 'fulfilled').length,
          ).toBe(1);
          const rejections = outcomes.filter(
            outcome => outcome.status === 'rejected',
          );
          expect(rejections.length).toBe(1);
          expect((rejections[0].reason as Error).message).toBe(
            'invalid or expired token',
          );
        }
      } finally {
        await Promise.all(connections.map(connection => connection.close()));
      }
    });

    it('confirmPasswordReset burns the participant’s other outstanding tokens', async () => {
      const participant = await createParticipantFixture();
      const usedToken = await createTokenFixture(participant.id);
      const otherToken = await createTokenFixture(participant.id);

      expect(
        await confirmPasswordReset(env, {
          token: usedToken,
          newPassword: 'brand-new-password',
        }),
      ).toEqual({ok: true});

      const result = await confirmPasswordReset(env, {
        token: otherToken,
        newPassword: 'attacker-password',
      });

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'invalid or expired token',
      });
    });
  },
);
