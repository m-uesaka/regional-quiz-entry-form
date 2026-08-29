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

const TOURNAMENT: Tournament = {
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
 * @param options.status The status to answer a PATCH with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.tournaments What the tournament list should hold.
 * @param options.calls Collects the recorded requests.
 */
function fakeFetch(
  options: {
    status?: number;
    error?: string;
    tournaments?: Tournament[];
    calls?: ApiCall[];
  } = {},
): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    options.calls?.push({
      method,
      url,
      body:
        init?.body === undefined
          ? undefined
          : (JSON.parse(String(init.body)) as unknown),
    });
    if (method === 'GET') {
      return jsonResponse(
        url.includes('/regions')
          ? [TOKYO]
          : (options.tournaments ?? [TOURNAMENT]),
      );
    }
    const status = options.status ?? 200;
    return status >= 400
      ? jsonResponse({error: options.error ?? 'nope'}, status)
      : jsonResponse(TOURNAMENT, status);
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
    params: {id: TOURNAMENT.id},
    fetch: fetchImpl,
    url: new URL(`http://localhost/admin/tournaments/${TOURNAMENT.id}/edit`),
  } as Parameters<typeof load>[0];
}

function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.update>[0] {
  return {
    params: {id: TOURNAMENT.id},
    fetch: fetchImpl,
    url: new URL(`http://localhost/admin/tournaments/${TOURNAMENT.id}/edit`),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.update>[0];
}

function updateFormData(overrides: Record<string, string> = {}): FormData {
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

describe('admin tournament edit +page.server load', () => {
  it('returns the tournament alongside the regions the form offers', async () => {
    await expect(load(buildLoadEvent(fakeFetch()))).resolves.toEqual({
      tournament: TOURNAMENT,
      regions: [TOKYO],
    });
  });

  it('reports an id that names no tournament as not found', async () => {
    await expect(
      load(buildLoadEvent(fakeFetch({tournaments: []}))),
    ).rejects.toMatchObject({status: 404} satisfies Partial<HttpError>);
  });
});

describe('admin tournament update action', () => {
  // Sent from the server, not the browser: `/api/*` is only routed to the
  // backend Worker for requests the frontend makes itself, so a client-side
  // PATCH 404s in production.
  it('updates the tournament, reading the entry window as JST', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({calls}),
      updateFormData({name: '改題した最強位'}),
    );

    await expect(actions.update(event)).resolves.toMatchObject({saved: true});
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `/api/tournaments/${TOURNAMENT.id}`,
        body: {
          regionId: TOKYO.id,
          type: 'saikyoi',
          name: '改題した最強位',
          capacity: 64,
          entryOpensAt: '2026-01-01T00:00:00.000Z',
          entryClosesAt: '2026-02-01T00:00:00.000Z',
        },
      },
    ]);
  });

  it('refuses a form the API would reject, without asking it', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({calls}),
      updateFormData({entryOpensAt: ''}),
    );

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 400,
      data: {saved: false, error: '入力内容を確認してください'},
    });
    expect(calls).toEqual([]);
  });

  it('reports a tournament that has since been removed', async () => {
    const event = buildActionEvent(fakeFetch({status: 404}), updateFormData());

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 404,
      data: {error: '大会が見つかりません'},
    });
  });

  it("surfaces the API's own refusal and re-renders what was typed", async () => {
    const event = buildActionEvent(
      fakeFetch({status: 400, error: 'insert or update violates foreign key'}),
      updateFormData({name: '書きかけの大会名'}),
    );

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error: 'insert or update violates foreign key',
        values: {name: '書きかけの大会名'},
      },
    });
  });
});
