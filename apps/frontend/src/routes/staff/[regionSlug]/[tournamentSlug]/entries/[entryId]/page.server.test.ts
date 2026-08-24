import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Entry, StaffClaims} from '@regional-quiz/shared';
import {load} from './+page.server';

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000003',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

const ENTRY: Entry = {
  id: '00000000-0000-0000-0000-000000000004',
  tournamentId: '00000000-0000-0000-0000-000000000001',
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationId: '00000000-0000-0000-0000-000000000005',
  freeText: '自由記述',
  customFieldValues: {},
  status: 'confirmed',
  waitlistPosition: null,
};

/** Builds a fake `fetch` that always resolves with the given JSON body. */
function fakeFetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
}): Parameters<typeof load>[0] {
  return {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: 'saikyoi',
      entryId: ENTRY.id,
    },
    fetch: options.fetch,
    locals: {staff: options.staff},
  } as Parameters<typeof load>[0];
}

describe('staff entry detail +page.server load', () => {
  it('throws 401 when there is no staff session', async () => {
    const event = buildEvent({fetch: fakeFetchReturning(ENTRY), staff: null});

    await expect(load(event)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<HttpError>);
  });

  it('returns the entry for authorized staff', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning(ENTRY),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({entry: ENTRY});
  });

  it('throws 404 when the entry is not found', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning({error: 'entry not found'}, 404),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 when staff are outside their scope', async () => {
    const event = buildEvent({
      fetch: fakeFetchReturning({error: 'forbidden'}, 403),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });
});
