import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';

// Local Supabase Postgres connection (`supabase start` default). Overridable
// via SUPABASE_DB_URL for other local setups.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

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

// Requires a running local Supabase instance (`supabase start`); skipped
// automatically when one isn't reachable, e.g. in CI.
describe.skipIf(!(await isDbReachable()))(
  'entries table (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testEmail = 'db-schema-test@example.com';
    const testRegionSlug = 'db-schema-test-region';

    afterAll(async () => {
      await sql`delete from entries where participant_id in (
        select id from participants where email = ${testEmail}
      )`;
      await sql`delete from participants where email = ${testEmail}`;
      await sql`delete from regulations where tournament_id in (
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

    it('enforces unique participant/tournament pair', async () => {
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
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, 'テストレギュレーション')
        returning id
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.id}, ${testEmail}, 'hash')
        returning id
      `;
      const entryInput = {
        participant_id: participant.id,
        tournament_id: tournament.id,
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        display_name: '太郎',
        regulation_id: regulation.id,
      };

      await sql`insert into entries ${sql(entryInput)}`;

      let duplicateInsertThrew = false;
      try {
        await sql`insert into entries ${sql(entryInput)}`;
      } catch {
        duplicateInsertThrew = true;
      }
      expect(duplicateInsertThrew).toBe(true);
    });
  },
);
