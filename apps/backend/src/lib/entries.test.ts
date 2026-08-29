import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {EntryInput, TournamentType} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {cancelOwnEntry, createEntry, updateOwnEntry} from './entries';
import {hashPassword} from './password';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

// Local Supabase Postgres connection (`supabase start` default), same
// convention as `lib/db-schema.test.ts`. Skipped automatically when one
// isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack,
// same as `routes/tournaments.test.ts` — not a real credential.
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
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

describe.skipIf(!(await isDbReachable()))(
  'createEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entries-lib-test-region';
    const testEmailDomain = 'entries-lib-test.example.com';
    const originalFetch = globalThis.fetch;
    let mailSendCount = 0;

    beforeAll(() => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          mailSendCount++;
          return new Response(null, {status: 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await sql`delete from email_verification_tokens where entry_id in (
        select id from entries where tournament_id in (
          select id from tournaments where region_id in (
            select id from regions where slug like ${testRegionSlug + '%'}
          )
        )
      )`;
      await sql`delete from form_field_defs where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from entries where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
      await sql.close();
    });

    interface TournamentFixture {
      regionId: string;
      tournamentId: string;
      regulationId: string;
    }

    async function createFixture(
      suffix: string,
      options: {
        entryOpensAt?: string;
        entryClosesAt?: string;
        capacity?: number | null;
        priorityStartsAt?: string | null;
        priorityEndsAt?: string | null;
        allowsDualEntry?: boolean;
        // `tournaments` is unique on (region_id, type), so the dual-entry
        // tests — which need both of a region's tournaments — pass the
        // region of an existing fixture together with the other type
        // instead of letting a second region be created.
        regionId?: string;
        type?: TournamentType;
      } = {},
    ): Promise<TournamentFixture> {
      let regionId = options.regionId;
      if (regionId === undefined) {
        const [region] = await sql`
          insert into regions (slug, name, allows_dual_entry)
          values (
            ${testRegionSlug + '-' + suffix}, 'テスト地域',
            ${options.allowsDualEntry ?? false}
          )
          returning id
        `;
        regionId = region.id as string;
      }
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${regionId}, ${options.type ?? 'saikyoi'}, 'テスト大会',
          ${options.capacity ?? null},
          ${options.entryOpensAt ?? '2020-01-01T00:00:00Z'},
          ${options.entryClosesAt ?? '2099-01-01T00:00:00Z'}
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (
          tournament_id, label, priority_starts_at, priority_ends_at
        ) values (
          ${tournament.id}, 'テストレギュレーション',
          ${options.priorityStartsAt ?? null},
          ${options.priorityEndsAt ?? null}
        )
        returning id
      `;
      return {
        regionId,
        tournamentId: tournament.id as string,
        regulationId: regulation.id as string,
      };
    }

    /**
     * Both tournaments of one region, with the region's dual-entry setting
     * as asked for. The 新人王 tournament is the "other" one every
     * dual-entry test enters second.
     * @param suffix The region slug suffix, as in `createFixture()`.
     * @param allowsDualEntry What the region's `allows_dual_entry` says.
     */
    async function createRegionPair(
      suffix: string,
      allowsDualEntry: boolean,
    ): Promise<{saikyoi: TournamentFixture; shinjinou: TournamentFixture}> {
      const saikyoi = await createFixture(suffix, {allowsDualEntry});
      const shinjinou = await createFixture(suffix, {
        regionId: saikyoi.regionId,
        type: 'shinjinou',
      });
      return {saikyoi, shinjinou};
    }

    function validInput(overrides: Partial<EntryInput> = {}): EntryInput {
      return {
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        displayName: '太郎',
        email: `entry-${crypto.randomUUID()}@${testEmailDomain}`,
        password: 'password123',
        passwordConfirm: 'password123',
        regulationIds: [],
        customFieldValues: {},
        ...overrides,
      };
    }

    /**
     * Adds a required `t_shirt_size` radio and an optional `topics` checkbox
     * to the fixture's tournament, so `createEntry()` has a form definition
     * to check the submitted answers against.
     */
    async function addFormFieldDefs(tournamentId: string): Promise<void> {
      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, options,
          display_order
        ) values (
          ${tournamentId}, 't_shirt_size', 'Tシャツサイズ', 'radio', true,
          ${['S', 'M', 'L']}::jsonb, 0
        )
      `;
      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, options,
          display_order
        ) values (
          ${tournamentId}, 'topics', '興味のある分野', 'checkbox', false,
          ${['歴史', '科学']}::jsonb, 1
        )
      `;
    }

    it('rejects entry outside the entry period', async () => {
      const fixture = await createFixture('closed', {
        entryOpensAt: '2020-01-01T00:00:00Z',
        entryClosesAt: '2020-01-02T00:00:00Z',
      });

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationIds: [fixture.regulationId]}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
    });

    it('rejects a non-priority regulation during the priority window', async () => {
      const fixture = await createFixture('priority', {
        priorityStartsAt: '2020-01-01T00:00:00Z',
        priorityEndsAt: '2099-01-01T00:00:00Z',
      });
      const [otherRegulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${fixture.tournamentId}, '対象外レギュレーション')
        returning id
      `;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationIds: [otherRegulation.id as string]}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
    });

    it('accepts a selection that includes the active priority regulation', async () => {
      // The window says only participants meeting that condition may enter,
      // not that they may claim nothing else — so a participant who also
      // meets a second condition may check both.
      const fixture = await createFixture('priority-plus-other', {
        priorityStartsAt: '2020-01-01T00:00:00Z',
        priorityEndsAt: '2099-01-01T00:00:00Z',
      });
      const [otherRegulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${fixture.tournamentId}, '対象外レギュレーション')
        returning id
      `;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [otherRegulation.id as string, fixture.regulationId],
        }),
      );

      expect(result.ok).toBe(true);
    });

    it('rejects an entry that selects no regulation at all', async () => {
      const fixture = await createFixture('no-regulation');

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationIds: []}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
    });

    it('stores every selected regulation', async () => {
      const fixture = await createFixture('multi-select');
      const [secondRegulation] = await sql`
        insert into regulations (tournament_id, label, display_order)
        values (${fixture.tournamentId}, '2つ目のレギュレーション', 1)
        returning id
      `;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId, secondRegulation.id as string],
        }),
      );

      expect(result.ok).toBe(true);
      const rows = await sql`
        select regulation_id, tournament_id from entry_regulations
        where entry_id = ${result.ok ? result.entry.id : ''}
        order by regulation_id
      `;
      expect(
        rows.map((row: {regulation_id: string}) => row.regulation_id).sort(),
      ).toEqual([fixture.regulationId, secondRegulation.id as string].sort());
      // The redundant column is what ties both composite foreign keys to
      // one tournament, so it has to be the entry's own.
      for (const row of rows) {
        expect(row.tournament_id).toBe(fixture.tournamentId);
      }
    });

    it('refuses a regulation belonging to another tournament', async () => {
      const fixture = await createFixture('foreign-regulation-own');
      const otherTournament = await createFixture('foreign-regulation-other');

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId, otherTournament.regulationId],
        }),
      );

      expect(result.ok).toBe(false);
      // Refused by `isRegulationSelectionAllowed()`, which only knows this
      // tournament's regulations — before any row is written. The DB-level
      // guarantee behind it (the shared `tournament_id` on both composite
      // foreign keys) is covered in `db-schema.test.ts`.
      expect(!result.ok && result.status).toBe(403);
      // Nothing is left behind.
      const [{count}] = await sql`
        select count(*)::int as count from entries
        where tournament_id = ${fixture.tournamentId}
      `;
      expect(count).toBe(0);
    });

    it('rejects an email already registered in a different region', async () => {
      const fixtureA = await createFixture('region-a');
      const fixtureB = await createFixture('region-b');
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      await sql`
        insert into participants (region_id, email, password_hash)
        values (${fixtureA.regionId}, ${email}, ${await hashPassword('password123')})
      `;

      const result = await createEntry(
        env,
        fixtureB.tournamentId,
        validInput({email, regulationIds: [fixtureB.regulationId]}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(409);
    });

    it('rejects re-entry under an existing email with the wrong password', async () => {
      const fixture = await createFixture('wrong-password');
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      await sql`
        insert into participants (region_id, email, password_hash)
        values (${fixture.regionId}, ${email}, ${await hashPassword('the-real-password')})
      `;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          email,
          password: 'a-wrong-password',
          passwordConfirm: 'a-wrong-password',
          regulationIds: [fixture.regulationId],
        }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(401);
    });

    it('creates a pending_verification entry and sends a verification email', async () => {
      const fixture = await createFixture('success');
      mailSendCount = 0;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationIds: [fixture.regulationId]}),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [entryRow] = await sql`
        select status from entries where id = ${result.entry.id}
      `;
      expect(entryRow.status).toBe('pending_verification');
      expect(mailSendCount).toBe(1);
    });

    it('rolls back the entry when the verification email fails to send, allowing a retry', async () => {
      const fixture = await createFixture('mail-failure');
      const input = validInput({regulationIds: [fixture.regulationId]});
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (
        requestInput: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url =
          typeof requestInput === 'string'
            ? requestInput
            : requestInput.toString();
        if (url.startsWith('https://api.resend.com/')) {
          return new Response(null, {status: 502});
        }
        return previousFetch(requestInput, init);
      }) as typeof fetch;

      try {
        const failedResult = await createEntry(
          env,
          fixture.tournamentId,
          input,
        );

        expect(failedResult.ok).toBe(false);
        expect(!failedResult.ok && failedResult.status).toBe(500);
        const rows = await sql`
          select id from entries
          where tournament_id = ${fixture.tournamentId}
        `;
        expect(rows.length).toBe(0);
      } finally {
        globalThis.fetch = previousFetch;
      }

      mailSendCount = 0;
      const retryResult = await createEntry(env, fixture.tournamentId, input);

      expect(retryResult.ok).toBe(true);
      expect(mailSendCount).toBe(1);
    });

    it('accepts empty answers when the tournament defines no custom fields', async () => {
      const fixture = await createFixture('no-custom-fields');

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId],
          customFieldValues: {},
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [row] = await sql`
        select custom_field_values from entries where id = ${result.entry.id}
      `;
      expect(row.custom_field_values).toEqual({});
    });

    it('stores custom field answers that match the form definition', async () => {
      const fixture = await createFixture('custom-fields-valid');
      await addFormFieldDefs(fixture.tournamentId);

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId],
          customFieldValues: {t_shirt_size: 'M', topics: ['歴史']},
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [row] = await sql`
        select status, custom_field_values from entries
        where id = ${result.entry.id}
      `;
      expect(row.status).toBe('pending_verification');
      expect(row.custom_field_values).toEqual({
        t_shirt_size: 'M',
        topics: ['歴史'],
      });
    });

    it('rejects custom field answers the tournament does not define', async () => {
      const fixture = await createFixture('custom-fields-unknown-key');
      await addFormFieldDefs(fixture.tournamentId);
      const input = validInput({
        regulationIds: [fixture.regulationId],
        customFieldValues: {t_shirt_size: 'M', junk: 'x'},
      });

      const result = await createEntry(env, fixture.tournamentId, input);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
      const entryRows = await sql`
        select id from entries where tournament_id = ${fixture.tournamentId}
      `;
      expect(entryRows.length).toBe(0);
      // The answers are checked before the participant lookup, so a rejected
      // submission doesn't leave an account behind either.
      const participantRows = await sql`
        select id from participants where email = ${input.email}
      `;
      expect(participantRows.length).toBe(0);
    });

    it('rejects an answer outside the field definition options', async () => {
      const fixture = await createFixture('custom-fields-unknown-option');
      await addFormFieldDefs(fixture.tournamentId);

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId],
          customFieldValues: {t_shirt_size: 'XXL'},
        }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
    });

    it('rejects a required custom field left blank', async () => {
      const fixture = await createFixture('custom-fields-required');
      await addFormFieldDefs(fixture.tournamentId);

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId],
          customFieldValues: {topics: ['歴史']},
        }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
    });

    it('rejects a scalar answer to a checkbox field', async () => {
      const fixture = await createFixture('custom-fields-scalar-checkbox');
      await addFormFieldDefs(fixture.tournamentId);

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          regulationIds: [fixture.regulationId],
          customFieldValues: {t_shirt_size: 'M', topics: '歴史'},
        }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
    });

    it('rejects a second entry for a tournament the participant is already in', async () => {
      const fixture = await createFixture('duplicate');
      const input = validInput({regulationIds: [fixture.regulationId]});
      const firstResult = await createEntry(env, fixture.tournamentId, input);
      expect(firstResult.ok).toBe(true);

      const secondResult = await createEntry(env, fixture.tournamentId, input);

      expect(secondResult.ok).toBe(false);
      expect(!secondResult.ok && secondResult.status).toBe(409);
    });

    it('reuses the same entry row with pending_verification status after cancellation', async () => {
      const fixture = await createFixture('re-entry');
      const input = validInput({regulationIds: [fixture.regulationId]});
      const firstResult = await createEntry(env, fixture.tournamentId, input);
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      await sql`
        update entries
        set status = 'cancelled', cancelled_at = now(), email_verified_at = now()
        where id = ${firstResult.entry.id}
      `;

      mailSendCount = 0;
      const reEntryResult = await createEntry(
        env,
        fixture.tournamentId,
        // A re-entry is a fresh submission of the form, so its contents may
        // differ from the cancelled entry's.
        {...input, displayName: '再エントリー太郎'},
      );

      expect(reEntryResult.ok).toBe(true);
      if (!reEntryResult.ok) return;
      expect(reEntryResult.entry.id).toBe(firstResult.entry.id);
      expect(mailSendCount).toBe(1);
      const rows = await sql`
        select id, status, display_name, cancelled_at, email_verified_at
        from entries where tournament_id = ${fixture.tournamentId}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('pending_verification');
      expect(rows[0].display_name).toBe('再エントリー太郎');
      expect(rows[0].cancelled_at).toBeNull();
      expect(rows[0].email_verified_at).toBeNull();
    });

    it('restores the cancellation when the re-entry verification email fails', async () => {
      const fixture = await createFixture('re-entry-mail-failure');
      const input = validInput({regulationIds: [fixture.regulationId]});
      const firstResult = await createEntry(env, fixture.tournamentId, input);
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      await sql`
        update entries
        set status = 'cancelled', cancelled_at = now(), email_verified_at = now()
        where id = ${firstResult.entry.id}
      `;
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (
        requestInput: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url =
          typeof requestInput === 'string'
            ? requestInput
            : requestInput.toString();
        if (url.startsWith('https://api.resend.com/')) {
          return new Response(null, {status: 502});
        }
        return previousFetch(requestInput, init);
      }) as typeof fetch;

      try {
        const failedResult = await createEntry(env, fixture.tournamentId, {
          // A re-entry submits its own form contents, which the reuse update
          // writes over the cancelled entry's before the mail is attempted.
          ...input,
          displayName: '再エントリー太郎',
          freeText: '再エントリーの備考',
        });

        expect(failedResult.ok).toBe(false);
        expect(!failedResult.ok && failedResult.status).toBe(500);
        // The row the re-entry reused is still there, back in the
        // cancellation it came from rather than deleted — and carrying the
        // original entry's contents, not the failed re-entry's.
        const rows = await sql`
          select id, status, cancelled_at, display_name, free_text,
                 email_verified_at
          from entries where tournament_id = ${fixture.tournamentId}
        `;
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(firstResult.entry.id);
        expect(rows[0].status).toBe('cancelled');
        expect(rows[0].cancelled_at).not.toBeNull();
        expect(rows[0].display_name).toBe(input.displayName);
        expect(rows[0].free_text).toBe(input.freeText ?? null);
        expect(rows[0].email_verified_at).not.toBeNull();
      } finally {
        globalThis.fetch = previousFetch;
      }
    });

    it('refuses a second tournament in a region that disallows dual entry', async () => {
      const {saikyoi, shinjinou} = await createRegionPair('dual-off', false);
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const firstResult = await createEntry(
        env,
        saikyoi.tournamentId,
        validInput({email, regulationIds: [saikyoi.regulationId]}),
      );
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      await sql`
        update entries set status = 'confirmed', email_verified_at = now()
        where id = ${firstResult.entry.id}
      `;

      const result = await createEntry(
        env,
        shinjinou.tournamentId,
        validInput({email, regulationIds: [shinjinou.regulationId]}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(409);
      expect(!result.ok && result.error).toBe(
        'already entered another tournament in this region',
      );
      const rows = await sql`
        select id from entries where tournament_id = ${shinjinou.tournamentId}
      `;
      expect(rows.length).toBe(0);
    });

    it('allows a second tournament when the region allows dual entry', async () => {
      const {saikyoi, shinjinou} = await createRegionPair('dual-on', true);
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const firstResult = await createEntry(
        env,
        saikyoi.tournamentId,
        validInput({email, regulationIds: [saikyoi.regulationId]}),
      );
      expect(firstResult.ok).toBe(true);

      const result = await createEntry(
        env,
        shinjinou.tournamentId,
        validInput({email, regulationIds: [shinjinou.regulationId]}),
      );

      expect(result.ok).toBe(true);
    });

    it('allows a second tournament when the first entry was cancelled', async () => {
      const {saikyoi, shinjinou} = await createRegionPair(
        'dual-off-cancelled',
        false,
      );
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const firstResult = await createEntry(
        env,
        saikyoi.tournamentId,
        validInput({email, regulationIds: [saikyoi.regulationId]}),
      );
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      // Cancelling frees the region: a participant who pulled out of one
      // tournament should be able to take part in the other.
      await sql`
        update entries set status = 'cancelled', cancelled_at = now()
        where id = ${firstResult.entry.id}
      `;

      const result = await createEntry(
        env,
        shinjinou.tournamentId,
        validInput({email, regulationIds: [shinjinou.regulationId]}),
      );

      expect(result.ok).toBe(true);
    });

    it('counts a pending_verification entry as occupying the region', async () => {
      const {saikyoi, shinjinou} = await createRegionPair(
        'dual-off-pending',
        false,
      );
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      // Left exactly as `createEntry()` made it: unverified, so this is the
      // "hold both seats and never follow either link" case.
      const firstResult = await createEntry(
        env,
        saikyoi.tournamentId,
        validInput({email, regulationIds: [saikyoi.regulationId]}),
      );
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      const [firstRow] = await sql`
        select status from entries where id = ${firstResult.entry.id}
      `;
      expect(firstRow.status).toBe('pending_verification');

      const result = await createEntry(
        env,
        shinjinou.tournamentId,
        validInput({email, regulationIds: [shinjinou.regulationId]}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(409);
      expect(!result.ok && result.error).toBe(
        'already entered another tournament in this region',
      );
    });

    it('still allows re-entering the same tournament after cancelling', async () => {
      // The dual-entry check looks at the region's *other* tournaments, so
      // it must not stand in the way of the reuse path above — the entry
      // being re-created is the very one that would otherwise count.
      const fixture = await createFixture('dual-off-same-tournament', {
        allowsDualEntry: false,
      });
      const input = validInput({regulationIds: [fixture.regulationId]});
      const firstResult = await createEntry(env, fixture.tournamentId, input);
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      await sql`
        update entries set status = 'cancelled', cancelled_at = now()
        where id = ${firstResult.entry.id}
      `;

      const result = await createEntry(env, fixture.tournamentId, input);

      expect(result.ok).toBe(true);
      expect(result.ok && result.entry.id).toBe(firstResult.entry.id);
    });
  },
);

describe.skipIf(!(await isDbReachable()))(
  'updateOwnEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entries-update-test-region';
    const testEmailDomain = 'entries-update-test.example.com';

    afterAll(async () => {
      await sql`delete from form_field_defs where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from entries where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
      await sql.close();
    });

    interface EntryFixture {
      participantId: string;
      entryId: string;
    }

    /**
     * Creates a region, tournament (with one `t_shirt_size` custom field),
     * regulation, participant and entry, and returns the ids needed to
     * exercise `updateOwnEntry()` against them.
     */
    async function createEntryFixture(
      suffix: string,
      options: {
        entryOpensAt?: string;
        entryClosesAt?: string;
        status?: string;
      } = {},
    ): Promise<EntryFixture> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会',
          ${options.entryOpensAt ?? '2020-01-01T00:00:00Z'},
          ${options.entryClosesAt ?? '2099-01-01T00:00:00Z'}
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, 'テストレギュレーション')
        returning id
      `;
      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, options,
          display_order
        ) values (
          ${tournament.id}, 't_shirt_size', 'Tシャツサイズ', 'radio', false,
          ${['S', 'M', 'L']}::jsonb, 0
        )
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (
          ${region.id},
          ${`update-${crypto.randomUUID()}@${testEmailDomain}`},
          'hash'
        )
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          free_text, custom_field_values, status
        ) values (
          ${participant.id}, ${tournament.id}, '山田太郎', 'ヤマダタロウ', '太郎',
          '元の自由記述', ${{t_shirt_size: 'M'}},
          ${options.status ?? 'confirmed'}
        )
        returning id
      `;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${regulation.id}, ${tournament.id})
      `;
      return {
        participantId: participant.id as string,
        entryId: entry.id as string,
      };
    }

    const patch = {
      name: '山田花子',
      furigana: 'ヤマダハナコ',
      displayName: '花子',
      freeText: '更新後の自由記述',
      customFieldValues: {t_shirt_size: 'L'},
    };

    it('updates the entry within the entry period', async () => {
      const fixture = await createEntryFixture('open');

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(true);
      const [row] = await sql`
        select name, furigana, display_name, free_text, custom_field_values
        from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田花子');
      expect(row.furigana).toBe('ヤマダハナコ');
      expect(row.display_name).toBe('花子');
      expect(row.free_text).toBe('更新後の自由記述');
      expect(row.custom_field_values).toEqual({t_shirt_size: 'L'});
    });

    it('rejects updates outside the entry period', async () => {
      const fixture = await createEntryFixture('closed', {
        entryOpensAt: '2020-01-01T00:00:00Z',
        entryClosesAt: '2020-01-02T00:00:00Z',
      });

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it("rejects updating another participant's entry", async () => {
      const fixture = await createEntryFixture('owner');
      const other = await createEntryFixture('other');

      const result = await updateOwnEntry(
        env,
        other.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(404);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it('rejects updating a cancelled entry', async () => {
      const fixture = await createEntryFixture('cancelled', {
        status: 'cancelled',
      });

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        patch,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it('rejects custom field answers the tournament does not define', async () => {
      const fixture = await createEntryFixture('unknown-field');

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        {...patch, customFieldValues: {...patch.customFieldValues, junk: 'x'}},
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
      const [row] = await sql`
        select name from entries where id = ${fixture.entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });

    it('rejects an answer outside the field definition options', async () => {
      const fixture = await createEntryFixture('unknown-option');

      const result = await updateOwnEntry(
        env,
        fixture.participantId,
        fixture.entryId,
        {...patch, customFieldValues: {t_shirt_size: 'XXL'}},
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(400);
    });
  },
);

describe.skipIf(!(await isDbReachable()))(
  'cancelOwnEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entries-cancel-test-region';
    const testEmailDomain = 'entries-cancel-test.example.com';
    const originalFetch = globalThis.fetch;
    let mailSendCount = 0;

    beforeAll(() => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          mailSendCount++;
          return new Response(null, {status: 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await sql`delete from email_verification_tokens where entry_id in (
        select id from entries where tournament_id in (
          select id from tournaments where region_id in (
            select id from regions where slug like ${testRegionSlug + '%'}
          )
        )
      )`;
      await sql`delete from entries where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
      await sql.close();
    });

    interface CancelFixture {
      regionId: string;
      tournamentId: string;
      regulationId: string;
    }

    async function createFixture(suffix: string): Promise<CancelFixture> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', 1,
          '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, 'テストレギュレーション')
        returning id
      `;
      return {
        regionId: region.id as string,
        tournamentId: tournament.id as string,
        regulationId: regulation.id as string,
      };
    }

    interface EntryFixture {
      participantId: string;
      entryId: string;
    }

    async function createEntryRow(
      fixture: CancelFixture,
      status: 'pending_verification' | 'confirmed' | 'waitlisted',
      waitlistPosition: number | null = null,
    ): Promise<EntryFixture> {
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (
          ${fixture.regionId},
          ${`cancel-${crypto.randomUUID()}@${testEmailDomain}`},
          'hash'
        )
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          status, waitlist_position
        ) values (
          ${participant.id}, ${fixture.tournamentId}, '山田太郎', 'ヤマダタロウ',
          '太郎', ${status}, ${waitlistPosition}
        )
        returning id
      `;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${fixture.regulationId}, ${fixture.tournamentId})
      `;
      return {
        participantId: participant.id as string,
        entryId: entry.id as string,
      };
    }

    it('cancels a confirmed entry and promotes the next waitlisted entry', async () => {
      const fixture = await createFixture('confirmed');
      const confirmed = await createEntryRow(fixture, 'confirmed');
      const firstWaiting = await createEntryRow(fixture, 'waitlisted', 1);
      const secondWaiting = await createEntryRow(fixture, 'waitlisted', 2);
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        confirmed.participantId,
        confirmed.entryId,
      );

      expect(result.ok).toBe(true);
      const [cancelledRow] = await sql`
        select status, cancelled_at, waitlist_position
        from entries where id = ${confirmed.entryId}
      `;
      expect(cancelledRow.status).toBe('cancelled');
      expect(cancelledRow.cancelled_at).not.toBeNull();
      const [promotedRow] = await sql`
        select status from entries where id = ${firstWaiting.entryId}
      `;
      expect(promotedRow.status).toBe('confirmed');
      const [stillWaitingRow] = await sql`
        select status from entries where id = ${secondWaiting.entryId}
      `;
      expect(stillWaitingRow.status).toBe('waitlisted');
      expect(mailSendCount).toBe(1);
    });

    it('cancels a waitlisted entry without promoting anyone', async () => {
      const fixture = await createFixture('waitlisted');
      const confirmed = await createEntryRow(fixture, 'confirmed');
      const firstWaiting = await createEntryRow(fixture, 'waitlisted', 1);
      const secondWaiting = await createEntryRow(fixture, 'waitlisted', 2);
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        firstWaiting.participantId,
        firstWaiting.entryId,
      );

      expect(result.ok).toBe(true);
      const [cancelledRow] = await sql`
        select status, waitlist_position
        from entries where id = ${firstWaiting.entryId}
      `;
      expect(cancelledRow.status).toBe('cancelled');
      expect(cancelledRow.waitlist_position).toBeNull();
      const [confirmedRow] = await sql`
        select status from entries where id = ${confirmed.entryId}
      `;
      expect(confirmedRow.status).toBe('confirmed');
      // Nobody was promoted, and the entry behind the cancelled one moved up
      // one place instead of being left with a gap in front of it.
      const [stillWaitingRow] = await sql`
        select status, waitlist_position
        from entries where id = ${secondWaiting.entryId}
      `;
      expect(stillWaitingRow.status).toBe('waitlisted');
      expect(stillWaitingRow.waitlist_position).toBe(1);
      expect(mailSendCount).toBe(0);
    });

    it("returns 404 for another participant's entry", async () => {
      const fixture = await createFixture('other-participant');
      const owner = await createEntryRow(fixture, 'confirmed');
      const intruder = await createEntryRow(fixture, 'waitlisted', 1);

      const result = await cancelOwnEntry(
        env,
        intruder.participantId,
        owner.entryId,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(404);
      const [row] = await sql`
        select status from entries where id = ${owner.entryId}
      `;
      expect(row.status).toBe('confirmed');
    });

    it('burns the verification token of an entry cancelled before it was verified', async () => {
      const fixture = await createFixture('unverified');
      const unverified = await createEntryRow(fixture, 'pending_verification');
      await sql`
        insert into email_verification_tokens (
          entry_id, token_hash, expires_at
        ) values (
          ${unverified.entryId},
          ${`cancel-token-${crypto.randomUUID()}`},
          '2099-01-01T00:00:00Z'
        )
      `;

      const result = await cancelOwnEntry(
        env,
        unverified.participantId,
        unverified.entryId,
      );

      expect(result.ok).toBe(true);
      // The verification link mailed out before the cancellation must not
      // still be able to confirm the entry afterwards.
      const [tokenRow] = await sql`
        select used_at from email_verification_tokens
        where entry_id = ${unverified.entryId}
      `;
      expect(tokenRow.used_at).not.toBeNull();
    });

    it('leaves an already-cancelled entry alone without promoting anyone', async () => {
      const fixture = await createFixture('already-cancelled');
      const confirmed = await createEntryRow(fixture, 'confirmed');
      const waiting = await createEntryRow(fixture, 'waitlisted', 1);
      await cancelOwnEntry(env, confirmed.participantId, confirmed.entryId);
      const [promotedRow] = await sql`
        select status from entries where id = ${waiting.entryId}
      `;
      expect(promotedRow.status).toBe('confirmed');
      mailSendCount = 0;

      const result = await cancelOwnEntry(
        env,
        confirmed.participantId,
        confirmed.entryId,
      );

      expect(result.ok).toBe(true);
      const [stillConfirmedRow] = await sql`
        select status from entries where id = ${waiting.entryId}
      `;
      expect(stillConfirmedRow.status).toBe('confirmed');
      expect(mailSendCount).toBe(0);
    });
  },
);
