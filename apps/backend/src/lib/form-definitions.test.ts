import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {FormDefinitionYaml} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {syncFormFieldDefs} from './form-definitions';

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

    afterAll(async () => {
      await sql`delete from form_field_defs where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug = ${testRegionSlug}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug = ${testRegionSlug}
      )`;
      await sql`delete from regions where slug = ${testRegionSlug}`;
      await sql.close();
    });

    it('syncFormFieldDefs replaces existing fields', async () => {
      const [region] = await sql`
        insert into regions (slug, name) values (${testRegionSlug}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', now(), now()
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

      const definition: FormDefinitionYaml = {
        tournamentSlug: 'test-tournament',
        fields: [
          {
            key: 'new_field',
            label: '新フィールド',
            type: 'checkbox',
            required: true,
          },
        ],
      };

      await syncFormFieldDefs(env, tournamentId, definition);

      const rows = await sql`
        select field_key from form_field_defs where tournament_id = ${tournamentId}
      `;

      expect(rows.length).toBe(1);
      expect(rows[0].field_key).toBe('new_field');
    });
  },
);
