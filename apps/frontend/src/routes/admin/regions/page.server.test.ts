import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Region} from '@regional-quiz/shared';
import {fakeCookies} from '../../../test-support/fake-cookies';
import {fakeFetch} from '../../../test-support/fake-fetch';
import {load} from './+page.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

/** Builds a fake `fetch` answering the regions list. */
function fakeApi(): typeof fetch {
  return fakeFetch([{method: 'GET', url: /^\/api\/regions$/, body: [TOKYO]}]);
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL('http://localhost/admin/regions'),
  } as Parameters<typeof load>[0];
}

describe('admin regions +page.server load', () => {
  it('returns the regions the API lists', async () => {
    await expect(load(buildLoadEvent(fakeApi()))).resolves.toEqual({
      regions: [TOKYO],
    });
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = fakeFetch([
      {method: 'GET', url: '/api/regions', status: 500, body: {error: 'boom'}},
    ]);

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
