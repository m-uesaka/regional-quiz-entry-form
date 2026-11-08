import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {COMMON_ERROR_CODES} from '@regional-quiz/shared';
import {confirmEntryByToken} from './entry-confirmation';
import {generateToken, hashToken} from './token';
import {testBindings} from '../test-support/bindings';
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
  type EntryRowStatus,
  type TournamentFixture,
} from '../test-support/db-fixtures';

const env = testBindings({
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
});

describe.skipIf(!(await isDbReachable()))(
  'confirmEntryByToken (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entry-confirmation-test-region';
    const testEmailDomain = 'entry-confirmation-test.example.com';

    afterAll(async () => {
      await deleteTestRegionRows(sql, testRegionSlug, testEmailDomain);
      await sql.close();
    });

    async function createFixture(
      suffix: string,
      capacity: number | null,
    ): Promise<TournamentFixture> {
      return createTournamentAndRegulation(sql, `${testRegionSlug}-${suffix}`, {
        capacity,
      });
    }

    async function createEntryFixture(
      fixture: TournamentFixture,
      status: EntryRowStatus = 'pending_verification',
    ): Promise<string> {
      const {entryId} = await createEntryRow(sql, fixture, testEmailDomain, {
        status,
      });
      return entryId;
    }

    async function createTokenFixture(
      entryId: string,
      options: {expiresAt?: string; used?: boolean} = {},
    ): Promise<string> {
      const token = generateToken();
      await sql`
        insert into email_verification_tokens (
          entry_id, token_hash, expires_at, used_at
        ) values (
          ${entryId}, ${await hashToken(token)},
          ${options.expiresAt ?? '2099-01-01T00:00:00Z'},
          ${options.used ? '2020-01-01T00:00:00Z' : null}
        )
      `;
      return token;
    }

    it('confirms a valid, unused token', async () => {
      const fixture = await createFixture('confirm', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createTokenFixture(entryId);

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({
        ok: true,
        entryStatus: 'confirmed',
        // What the frontend needs to drop the list from its cache (#125).
        tournament: {regionSlug: `${testRegionSlug}-confirm`, type: 'saikyoi'},
      });
      const [entryRow] = await sql`
        select status, email_verified_at from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('confirmed');
      expect(entryRow.email_verified_at).not.toBeNull();
    });

    // Following the link proves the address, and the link belongs to a
    // submission made with the account's current password and region (#189).
    it('marks the participant verified, keeping the first verification time', async () => {
      const fixture = await createFixture('verify-account', null);
      const entryId = await createEntryFixture(fixture);
      const [{participant_id: participantId}] = await sql`
        select participant_id from entries where id = ${entryId}
      `;
      const [before] = await sql`
        select email_verified_at from participants where id = ${participantId}
      `;
      expect(before.email_verified_at).toBeNull();

      expect(
        await confirmEntryByToken(env, await createTokenFixture(entryId)),
      ).toMatchObject({ok: true});

      const [after] = await sql`
        select email_verified_at from participants where id = ${participantId}
      `;
      expect(after.email_verified_at).not.toBeNull();

      // A later confirmation of another entry leaves the original time alone.
      // The other region uses questions of its own, so the first entry, now
      // confirmed, doesn't rule it out (0043).
      const otherFixture = await createFixture('verify-account-again', null);
      await sql`
        update tournaments set question_set = '独自'
        where id = ${otherFixture.tournamentId}
      `;
      const [otherEntry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name
        ) values (
          ${participantId}, ${otherFixture.tournamentId}, '山田太郎',
          'ヤマダタロウ', '太郎'
        )
        returning id
      `;
      expect(
        await confirmEntryByToken(env, await createTokenFixture(otherEntry.id)),
      ).toMatchObject({ok: true});
      const [later] = await sql`
        select email_verified_at from participants where id = ${participantId}
      `;
      expect(later.email_verified_at).toEqual(after.email_verified_at);
    });

    it('leaves the participant unverified when the token is refused', async () => {
      const fixture = await createFixture('verify-account-refused', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createTokenFixture(entryId, {
        expiresAt: '2020-01-01T00:00:00Z',
      });

      expect(await confirmEntryByToken(env, token)).toMatchObject({ok: false});

      const [participant] = await sql`
        select p.email_verified_at from participants p
        join entries e on e.participant_id = p.id
        where e.id = ${entryId}
      `;
      expect(participant.email_verified_at).toBeNull();
    });

    it('waitlists an entry when capacity is full', async () => {
      const fixture = await createFixture('capacity', 1);
      await createEntryFixture(fixture, 'confirmed');
      const entryId = await createEntryFixture(fixture);
      const token = await createTokenFixture(entryId);

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({
        ok: true,
        entryStatus: 'waitlisted',
        tournament: {
          regionSlug: `${testRegionSlug}-capacity`,
          type: 'saikyoi',
        },
      });
      const [entryRow] = await sql`
        select status, waitlist_position from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('waitlisted');
      expect(entryRow.waitlist_position).toBe(1);
    });

    it('rejects an expired token', async () => {
      const fixture = await createFixture('expired', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createTokenFixture(entryId, {
        expiresAt: '2020-01-01T00:00:00Z',
      });

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });

    it('rejects an already-used token', async () => {
      const fixture = await createFixture('used', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createTokenFixture(entryId, {used: true});

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });

    it('rejects a valid token whose entry is no longer pending', async () => {
      const fixture = await createFixture('cancelled', null);
      const entryId = await createEntryFixture(fixture, 'cancelled');
      // A token a re-entry inserted while the cancellation was running: the
      // cancellation never saw it, so it is still unused and unexpired.
      const token = await createTokenFixture(entryId);

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
      const [entryRow] = await sql`
        select status from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('cancelled');
    });

    it('rejects an unknown token', async () => {
      const result = await confirmEntryByToken(env, generateToken());

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });
  },
);
