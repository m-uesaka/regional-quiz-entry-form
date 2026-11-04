import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {FormDefinitionYaml, TournamentType} from '@regional-quiz/shared';
import {
  syncFormFieldDefs,
  TournamentNotFoundError,
  TournamentSlugMismatchError,
} from './form-definitions';
import {testBindings} from '../test-support/bindings';
import {
  DB_URL,
  isDbReachable,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
} from '../test-support/db';

const env = testBindings({
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
});

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
