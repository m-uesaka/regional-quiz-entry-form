import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {
  createMailJob,
  fetchMailJob,
  fetchMailJobContent,
  recordMailJobProgress,
} from './mail-jobs';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

// Local Supabase Postgres connection (`supabase start` default), same
// convention as `lib/db-schema.test.ts`. Skipped automatically when one
// isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
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

const CONTENT = {subject: '大会のご案内', bodyHtml: '<p>お待ちしています</p>'};
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!(await isDbReachable()))(
  'mail jobs (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'mail-jobs-lib-test-region';
    let tournamentId = '';
    let otherTournamentId = '';

    beforeAll(async () => {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug}, 'テスト地域')
        returning id
      `;
      const tournaments = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values
          (${region.id}, 'saikyoi', 'テスト最強位', now(), now()),
          (${region.id}, 'shinjinou', 'テスト新人王', now(), now())
        returning id
      `;
      tournamentId = tournaments[0].id;
      otherTournamentId = tournaments[1].id;
    });

    afterAll(async () => {
      await sql`delete from mail_jobs where tournament_id in (
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

    async function newJob(total = 10): Promise<string> {
      const created = await createMailJob(env, {
        tournamentId,
        total,
        ...CONTENT,
      });
      if (!created.ok) {
        throw new Error(created.error);
      }
      return created.value;
    }

    it('records a send with its content and recipient count', async () => {
      const jobId = await newJob(7);

      const job = await fetchMailJob(env, tournamentId, jobId);

      expect(job).toEqual({
        ok: true,
        value: {
          id: jobId,
          tournamentId,
          subject: CONTENT.subject,
          bodyHtml: CONTENT.bodyHtml,
          total: 7,
          sent: 0,
          failed: 0,
          // Written by the database, so only their presence is asserted.
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      });
    });

    it('reads back the content the consumer sends', async () => {
      const jobId = await newJob();

      const content = await fetchMailJobContent(env, jobId);

      expect(content).toEqual({
        ok: true,
        value: {
          id: jobId,
          subject: CONTENT.subject,
          bodyHtml: CONTENT.bodyHtml,
        },
      });
    });

    it('reports an unknown job as absent rather than as an error', async () => {
      // The consumer tells the two apart: a missing row means there is
      // nothing to send, while an error means try again later.
      expect(await fetchMailJobContent(env, UNKNOWN_ID)).toEqual({
        ok: true,
        value: null,
      });
      expect(await fetchMailJob(env, tournamentId, UNKNOWN_ID)).toEqual({
        ok: true,
        value: null,
      });
    });

    it('hides a job belonging to another tournament', async () => {
      const jobId = await newJob();

      // What makes the staff endpoint's scope check hold: the job is
      // looked up by tournament as well as by id.
      expect(await fetchMailJob(env, otherTournamentId, jobId)).toEqual({
        ok: true,
        value: null,
      });
    });

    it('adds each batch to the counters instead of overwriting them', async () => {
      const jobId = await newJob();

      await recordMailJobProgress(env, jobId, {sent: 3, failed: 1});
      await recordMailJobProgress(env, jobId, {sent: 2, failed: 0});

      const job = await fetchMailJob(env, tournamentId, jobId);
      expect(job.ok && job.value).toMatchObject({sent: 5, failed: 1});
    });

    it('loses no increment when batches report at the same time', async () => {
      const jobId = await newJob(20);

      // Consumer invocations run concurrently, which is the whole reason
      // the counters are moved by a database function rather than by
      // reading them and writing them back: ten read-modify-write rounds
      // racing like this would land well short of ten.
      await Promise.all(
        Array.from({length: 10}, () =>
          recordMailJobProgress(env, jobId, {sent: 1, failed: 0}),
        ),
      );

      const job = await fetchMailJob(env, tournamentId, jobId);
      expect(job.ok && job.value).toMatchObject({sent: 10, failed: 0});
    });

    it('moves `updated_at` so a stalled send can be told from a slow one', async () => {
      const jobId = await newJob();
      const before = await fetchMailJob(env, tournamentId, jobId);

      await recordMailJobProgress(env, jobId, {sent: 1, failed: 0});

      const after = await fetchMailJob(env, tournamentId, jobId);
      expect(
        Date.parse(after.ok && after.value ? after.value.updatedAt : ''),
      ).toBeGreaterThan(
        Date.parse(before.ok && before.value ? before.value.updatedAt : ''),
      );
    });

    it('ignores progress reported for a job that is gone', async () => {
      // Failing the batch over a deleted row would have the consumer
      // retry -- and so re-send -- messages that were delivered.
      expect(
        await recordMailJobProgress(env, UNKNOWN_ID, {sent: 1, failed: 0}),
      ).toEqual({ok: true, value: undefined});
    });
  },
);
