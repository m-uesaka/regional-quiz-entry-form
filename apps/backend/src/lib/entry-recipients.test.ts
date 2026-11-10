import {afterEach, describe, expect, it} from 'bun:test';
import {EntryStatusSchema} from '@regional-quiz/shared';
import {
  DEFAULT_EXCLUDED_STATUSES,
  DEFAULT_RECIPIENT_STATUSES,
  fetchTournamentRecipients,
} from './entry-recipients';
import {testBindings} from '../test-support/bindings';

const ENV = testBindings();

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

  // #192: an unconfirmed entry may carry a stranger's address.
  it('reaches only confirmed and waitlisted entries when no status filter is given', async () => {
    const urls = mockFetch([[row('taro@example.com')]]);

    const result = await fetchTournamentRecipients(ENV, TOURNAMENT_ID);

    expect(result).toEqual({ok: true, recipients: ['taro@example.com']});
    expect(urls[0]).toContain(`tournament_id=eq.${TOURNAMENT_ID}`);
    expect(decodeURIComponent(urls[0])).toContain(
      'status=in.(confirmed,waitlisted)',
    );
  });

  // The default is an allow-list, so a status added to the enum later would
  // silently drop out of every default send. This makes adding one a
  // decision: it has to be put on one side or the other.
  it('classifies every entry status as either mailed or left out by default', () => {
    expect(
      [...DEFAULT_RECIPIENT_STATUSES, ...DEFAULT_EXCLUDED_STATUSES].sort(),
    ).toEqual([...EntryStatusSchema.options].sort());
  });

  // #192: the status stands in for a confirmed address only as long as every
  // way into it goes through the confirmation link, so the address itself
  // is checked too -- whatever the filter.
  it('reaches only participants who confirmed their address', async () => {
    for (const statusFilter of [undefined, 'cancelled'] as const) {
      const urls = mockFetch([[row('taro@example.com')]]);

      await fetchTournamentRecipients(ENV, TOURNAMENT_ID, statusFilter);

      expect(decodeURIComponent(urls[0])).toContain(
        'participants!inner(email)',
      );
      expect(urls[0]).toContain('participants.email_verified_at=not.is.null');
    }
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
    expect(urls[0]).not.toContain('status=in.');
  });

  it('keeps paging until an empty page arrives', async () => {
    const urls = mockFetch([
      [row('a@example.com'), row('b@example.com')],
      [row('c@example.com'), row('d@example.com')],
      [row('e@example.com')],
      [],
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
    expect(urls).toHaveLength(4);
  });

  // #292: a hosted `max_rows` below the page size trims every page, so a
  // short page is not the end; stopping there would drop recipients.
  it('does not stop on a page the server trimmed below the page size', async () => {
    const urls = mockFetch([
      [row('a@example.com')],
      [row('b@example.com')],
      [row('c@example.com')],
      [],
    ]);

    const result = await fetchTournamentRecipients(
      ENV,
      TOURNAMENT_ID,
      undefined,
      3,
    );

    expect(result).toEqual({
      ok: true,
      recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    });
    expect(urls).toHaveLength(4);
    // Each request starts right after the rows actually received, not a
    // full page further on, so no row is skipped.
    expect(urls.map(url => new URL(url).searchParams.get('offset'))).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
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

  it('rejects a page size that is not a positive integer', async () => {
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

  it('reports a failed query instead of returning a partial list', async () => {
    mockFetch([Response.json({message: 'db is down'}, {status: 500})]);

    const result = await fetchTournamentRecipients(ENV, TOURNAMENT_ID);

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'db is down',
    });
  });
});
