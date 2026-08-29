import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {FormDefinitionYaml, TournamentType} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {
  syncFormFieldDefs,
  TournamentNotFoundError,
  TournamentSlugMismatchError,
} from './form-definitions';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

// Local Supabase Postgres connection (`supabase start` default). Overridable
// via SUPABASE_DB_URL for other local setups, same convention as
// `lib/db-schema.test.ts`.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack
// (fixed `super-secret-jwt-token-with-at-least-32-characters-long` JWT
// secret) — not a real credential, safe to commit.
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
  'form-definitions lib (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'form-definitions-lib-test-region';

    // `tournaments` is unique on `(region_id, type)`, so each test gets its
    // own region (suffixed slug) rather than sharing one.
    const testRegionSlugPattern = `${testRegionSlug}-%`;

    async function deleteTestRegions(): Promise<void> {
      await sql`delete from form_field_defs where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlugPattern}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlugPattern}
      )`;
      await sql`delete from regions where slug like ${testRegionSlugPattern}`;
    }

    // Also cleaned up up front, so rows left behind by an interrupted run
    // don't collide with this run's inserts.
    beforeAll(deleteTestRegions);

    afterAll(async () => {
      await deleteTestRegions();
      await sql.close();
    });

    /**
     * Inserts a tournament of the given type in the test region, along with
     * two pre-existing form field definitions, and returns its ID. The
     * existing rows let each test assert whether the sync went through or
     * left the tournament's definitions untouched.
     * @param regionSuffix Distinguishes this test's region from the others'.
     * @param type The tournament type to create.
     */
    async function createTournamentWithExistingDefs(
      regionSuffix: string,
      type: TournamentType,
    ): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${`${testRegionSlug}-${regionSuffix}`}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, ${type}, 'テスト大会', now(), now()
        )
        returning id
      `;
      const tournamentId = tournament.id as string;

      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, display_order
        ) values
          (${tournamentId}, 'old_field_1', '旧フィールド1', 'checkbox', false, 0),
          (${tournamentId}, 'old_field_2', '旧フィールド2', 'textarea', false, 1)
      `;
      return tournamentId;
    }

    function definitionFor(tournamentSlug: TournamentType): FormDefinitionYaml {
      return {
        tournamentSlug,
        fields: [
          {
            key: 'new_field',
            label: '新フィールド',
            type: 'checkbox',
            required: true,
          },
        ],
      };
    }

    async function fieldKeysOf(tournamentId: string): Promise<string[]> {
      const rows = await sql`
        select field_key from form_field_defs
        where tournament_id = ${tournamentId}
        order by display_order
      `;
      return rows.map((row: {field_key: string}) => row.field_key);
    }

    it('syncFormFieldDefs replaces existing fields', async () => {
      const tournamentId = await createTournamentWithExistingDefs(
        'replace',
        'saikyoi',
      );

      await syncFormFieldDefs(env, tournamentId, definitionFor('saikyoi'));

      expect(await fieldKeysOf(tournamentId)).toEqual(['new_field']);
    });

    it('rejects a definition whose slug is another tournament type', async () => {
      const tournamentId = await createTournamentWithExistingDefs(
        'mismatch',
        'saikyoi',
      );

      await expect(
        syncFormFieldDefs(env, tournamentId, definitionFor('shinjinou')),
      ).rejects.toBeInstanceOf(TournamentSlugMismatchError);

      // The whole point of the check: the existing definitions must survive,
      // since `sync_form_field_defs()` would otherwise have deleted them.
      expect(await fieldKeysOf(tournamentId)).toEqual([
        'old_field_1',
        'old_field_2',
      ]);
    });

    it('rejects an unknown tournament ID', async () => {
      await expect(
        syncFormFieldDefs(
          env,
          '00000000-0000-0000-0000-000000000000',
          definitionFor('saikyoi'),
        ),
      ).rejects.toBeInstanceOf(TournamentNotFoundError);
    });
  },
);
