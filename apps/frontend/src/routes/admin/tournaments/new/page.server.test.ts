import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Region, Tournament} from '@regional-quiz/shared';
import {fakeCookies} from '../../../../test-support/fake-cookies';
import {
  fakeFetch,
  type RecordedRequest,
} from '../../../../test-support/fake-fetch';
import {actions, load} from './+page.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000011',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

const CREATED: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: TOKYO.id,
  type: 'saikyoi',
  name: '第1回テスト最強位',
  capacity: 64,
  entryOpensAt: '2026-01-01T00:00:00.000Z',
  entryClosesAt: '2026-02-01T00:00:00.000Z',
  entriesPaused: false,
};

/**
 * Builds a fake `fetch` answering the regions and tournaments APIs.
 * @param options.status The status to answer a POST with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.calls Collects the requests sent.
 */
function fakeApi(
  options: {status?: number; error?: string; calls?: RecordedRequest[]} = {},
): typeof fetch {
  const status = options.status ?? 201;
  return fakeFetch(
    [
      {method: 'GET', url: '/api/regions', body: [TOKYO]},
      {
        method: 'POST',
        url: /^\/api\/tournaments$/,
        status,
        body: status >= 400 ? {error: options.error ?? 'nope'} : CREATED,
      },
    ],
    options.calls,
  );
}

function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL('http://localhost/admin/tournaments/new'),
  } as Parameters<typeof load>[0];
}

function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL('http://localhost/admin/tournaments/new'),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

function createFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('regionId', TOKYO.id);
  formData.set('type', 'saikyoi');
  formData.set('name', '第1回テスト最強位');
  formData.set('capacity', '64');
  formData.set('entryOpensAt', '2026-01-01T09:00');
  formData.set('entryClosesAt', '2026-02-01T09:00');
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value);
  }
  return formData;
}

describe('admin tournament create +page.server load', () => {
  it('returns the regions the form offers', async () => {
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

describe('admin tournament create action', () => {
  // Sent from the server, not the browser: `/api/*` is only routed to the
  // backend Worker for requests the frontend makes itself, so a client-side
  // POST 404s in production.
  it('creates the tournament, reading the entry window as JST', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(fakeApi({calls}), createFormData());

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: `/admin/tournaments/${CREATED.id}/edit`,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/tournaments',
        body: {
          regionId: TOKYO.id,
          type: 'saikyoi',
          name: '第1回テスト最強位',
          capacity: 64,
          entryOpensAt: '2026-01-01T00:00:00.000Z',
          entryClosesAt: '2026-02-01T00:00:00.000Z',
        },
      },
    ]);
  });

  it('takes a blank capacity as no limit', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      createFormData({capacity: ''}),
    );

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(calls[0].body).toMatchObject({capacity: null});
  });

  // 大会名 is optional: the API names the tournament after its region and
  // type when it is left blank.
  it('passes a blank name on for the API to fill in', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      createFormData({name: ''}),
    );

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(calls[0].body).toMatchObject({name: ''});
  });

  it('refuses a form the API would reject, without asking it', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      createFormData({regionId: ''}),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {error: '入力内容を確認してください'},
    });
    expect(calls).toEqual([]);
  });

  it("surfaces the API's own refusal and re-renders what was typed", async () => {
    const event = buildActionEvent(
      fakeApi({status: 400, error: 'insert or update violates foreign key'}),
      createFormData({name: '書きかけの大会名'}),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error: 'insert or update violates foreign key',
        values: {name: '書きかけの大会名'},
      },
    });
  });

  it('surfaces a duplicate tournament, which the API answers with 409', async () => {
    const event = buildActionEvent(
      fakeApi({
        status: 409,
        error: 'この地域には同じ種別の大会がすでにあります',
      }),
      createFormData({name: '書きかけの大会名'}),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 409,
      data: {
        error: 'この地域には同じ種別の大会がすでにあります',
        values: {name: '書きかけの大会名'},
      },
    });
  });
});
