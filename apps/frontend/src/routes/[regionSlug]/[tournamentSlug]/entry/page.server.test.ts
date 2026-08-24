import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {StaffClaims, Tournament} from '@regional-quiz/shared';
import {load} from './+page.server';

// Well in the past relative to any plausible test run time, so this is
// reliably outside the entry period without needing to inject `now`.
const OUT_OF_PERIOD_TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2020-02-01T00:00:00.000Z',
};

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000003',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

/** Builds a fake `fetch` that always resolves with the given JSON body. */
function fakeFetchReturning(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 404,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
  tournamentSlug?: string;
}): Parameters<typeof load>[0] {
  return {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: options.tournamentSlug ?? 'saikyoi',
    },
    fetch: options.fetch,
    locals: {staff: options.staff},
  } as Parameters<typeof load>[0];
}

describe('entry +page.server load', () => {
  it('throws 403 when outside the entry period and no staff session', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning(OUT_OF_PERIOD_TOURNAMENT),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('succeeds outside the entry period when a staff session is present', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning(OUT_OF_PERIOD_TOURNAMENT),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({
      tournament: OUT_OF_PERIOD_TOURNAMENT,
    });
  });

  it('throws 404 when the backend responds not-ok', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning({error: 'tournament not found'}, false),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning(OUT_OF_PERIOD_TOURNAMENT),
      staff: null,
      tournamentSlug: 'nope',
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });
});
