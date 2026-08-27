import {afterEach, describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import app from '../index';

// Publicly documented local-dev demo key for Supabase CLI's default stack
// (fixed `super-secret-jwt-token-with-at-least-32-characters-long` JWT
// secret) — not a real credential, safe to commit.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const env: Bindings = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

// This request is rejected by `zValidator()` before any database call, so it
// runs unconditionally (including CI).
describe('GET /tournaments/:tournamentId/regulations (request validation)', () => {
  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/regulations',
      {},
      env,
    );

    expect(res.status).toBe(400);
  });
});

// Mocks the `fetch` call `@supabase/supabase-js` makes for
// `.from('regulations').select(...)` (same convention as
// `routes/entry-list.test.ts`'s `mockEntriesFetch`), so these run
// unconditionally in CI without a local Supabase stack.
function mockRegulationsFetch(rows: unknown[]): void {
  globalThis.fetch = (() =>
    Promise.resolve(Response.json(rows))) as unknown as typeof fetch;
}

// Reaching this handler at all already demonstrates route precedence: the
// path also matches `tournamentsRoute`'s `/:regionSlug/:tournamentSlug`,
// whose `tournamentSlug` enum validation would 400 on `regulations` before
// the mocked fetch below was ever consulted.
describe('GET /tournaments/:tournamentId/regulations (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  const tournamentId = '12345678-1234-1234-1234-123456789012';

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the tournament regulations in the API shape', async () => {
    mockRegulationsFetch([
      {
        id: '22222222-2222-2222-2222-222222222222',
        tournament_id: tournamentId,
        label: '一般の部',
        priority_starts_at: '2026-01-01T00:00:00+00:00',
        priority_ends_at: '2026-01-08T00:00:00+00:00',
        display_order: 0,
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        tournament_id: tournamentId,
        label: '学生の部',
        priority_starts_at: null,
        priority_ends_at: null,
        display_order: 1,
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      id: '22222222-2222-2222-2222-222222222222',
      tournamentId,
      label: '一般の部',
      priorityStartsAt: '2026-01-01T00:00:00+00:00',
      priorityEndsAt: '2026-01-08T00:00:00+00:00',
      displayOrder: 0,
    });
    expect(body[1].priorityStartsAt).toBeNull();
  });

  it('returns an empty list for a tournament with no regulations', async () => {
    mockRegulationsFetch([]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {},
      env,
    );

    const body = (await res.json()) as unknown[];

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});
