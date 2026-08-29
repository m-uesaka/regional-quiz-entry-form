import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Region, Tournament} from '@regional-quiz/shared';
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
};

/** One request an action put on the wire. */
interface ApiCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Builds a fake `fetch` answering the regions and tournaments APIs.
 * @param options.status The status to answer a POST with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.calls Collects the recorded requests.
 */
function fakeFetch(
  options: {status?: number; error?: string; calls?: ApiCall[]} = {},
): typeof fetch {
  return (async (input, init) => {
    const method = init?.method ?? 'GET';
    options.calls?.push({
      method,
      url: String(input),
      body:
        init?.body === undefined
          ? undefined
          : (JSON.parse(String(init.body)) as unknown),
    });
    if (method === 'GET') return jsonResponse([TOKYO]);
    const status = options.status ?? 201;
    return status >= 400
      ? jsonResponse({error: options.error ?? 'nope'}, status)
      : jsonResponse(CREATED, status);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    url: new URL('http://localhost/admin/tournaments/new'),
  } as Parameters<typeof load>[0];
}

function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    fetch: fetchImpl,
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
    await expect(load(buildLoadEvent(fakeFetch()))).resolves.toEqual({
      regions: [TOKYO],
    });
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = (async () =>
      jsonResponse({error: 'boom'}, 500)) as typeof fetch;

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
    const calls: ApiCall[] = [];
    const event = buildActionEvent(fakeFetch({calls}), createFormData());

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
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({calls}),
      createFormData({capacity: ''}),
    );

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(calls[0].body).toMatchObject({capacity: null});
  });

  it('refuses a form the API would reject, without asking it', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({calls}),
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
      fakeFetch({status: 400, error: 'insert or update violates foreign key'}),
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
});
