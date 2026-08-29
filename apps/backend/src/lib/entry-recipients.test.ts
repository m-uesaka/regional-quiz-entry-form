import {afterEach, describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import {fetchTournamentRecipients} from './entry-recipients';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const TOURNAMENT_ID = '44444444-4444-4444-4444-444444444444';

function row(email: string): {participants: {email: string}} {
  return {participants: {email}};
}

/**
 * Answers each Supabase call from `pages` in order and records the request
 * URLs, so a test can assert both what came back and how it was asked for.
 * A `pages` entry may be a ready-made `Response` to simulate a failure.
 */
function mockFetch(pages: unknown[]): string[] {
  const urls: string[] = [];
  let callIndex = 0;
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : String(input));
    const page = pages[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(
      page instanceof Response ? page : Response.json(page),
    );
  }) as unknown as typeof fetch;
  return urls;
}

describe('fetchTournamentRecipients', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('excludes cancelled entries when no status filter is given', async () => {
    const urls = mockFetch([[row('taro@example.com')]]);

    const result = await fetchTournamentRecipients(ENV, TOURNAMENT_ID);

    expect(result).toEqual({ok: true, recipients: ['taro@example.com']});
    expect(urls[0]).toContain(`tournament_id=eq.${TOURNAMENT_ID}`);
    expect(urls[0]).toContain('status=neq.cancelled');
  });

  it('narrows to one status when a status filter is given', async () => {
    const urls = mockFetch([[row('taro@example.com')]]);

    const result = await fetchTournamentRecipients(
      ENV,
      TOURNAMENT_ID,
      'cancelled',
    );

    expect(result).toEqual({ok: true, recipients: ['taro@example.com']});
    expect(urls[0]).toContain('status=eq.cancelled');
    expect(urls[0]).not.toContain('status=neq.');
  });

  it('keeps paging until a short page arrives', async () => {
    const urls = mockFetch([
      [row('a@example.com'), row('b@example.com')],
      [row('c@example.com'), row('d@example.com')],
      [row('e@example.com')],
    ]);

    const result = await fetchTournamentRecipients(
      ENV,
      TOURNAMENT_ID,
      undefined,
      2,
    );

    expect(result).toEqual({
      ok: true,
      recipients: [
        'a@example.com',
        'b@example.com',
        'c@example.com',
        'd@example.com',
        'e@example.com',
      ],
    });
    expect(urls).toHaveLength(3);
  });

  it('stops on an exactly-full last page followed by an empty one', async () => {
    const urls = mockFetch([[row('a@example.com'), row('b@example.com')], []]);

    const result = await fetchTournamentRecipients(
      ENV,
      TOURNAMENT_ID,
      undefined,
      2,
    );

    expect(result).toEqual({
      ok: true,
      recipients: ['a@example.com', 'b@example.com'],
    });
    expect(urls).toHaveLength(2);
  });

  it('rejects a page size that would never end the loop', async () => {
    const urls = mockFetch([]);

    for (const pageSize of [0, -1, 1.5, Number.NaN]) {
      await expect(
        fetchTournamentRecipients(ENV, TOURNAMENT_ID, undefined, pageSize),
      ).rejects.toThrow(RangeError);
    }
    expect(urls).toEqual([]);
  });

  it('de-duplicates an address that appears on several entries', async () => {
    mockFetch([[row('taro@example.com'), row('taro@example.com')]]);

    const result = await fetchTournamentRecipients(ENV, TOURNAMENT_ID);

    expect(result).toEqual({ok: true, recipients: ['taro@example.com']});
  });

  it('skips an entry with no participant row', async () => {
    mockFetch([[{participants: null}, row('taro@example.com')]]);

    const result = await fetchTournamentRecipients(ENV, TOURNAMENT_ID);

    expect(result).toEqual({ok: true, recipients: ['taro@example.com']});
  });

  it('reports a failed query instead of returning a partial list', async () => {
    mockFetch([Response.json({message: 'db is down'}, {status: 500})]);

    const result = await fetchTournamentRecipients(ENV, TOURNAMENT_ID);

    expect(result).toEqual({ok: false, error: 'db is down'});
  });
});
