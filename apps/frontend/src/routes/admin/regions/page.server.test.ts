import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Region} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

/** One request the action put on the wire. */
interface ApiCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Builds a fake `fetch` answering the regions API, recording what it was
 * sent.
 * @param options.status The status to answer a create/update with.
 * @param options.calls Collects the recorded requests.
 */
function fakeFetch(options: {
  status?: number;
  calls?: ApiCall[];
}): typeof fetch {
  return (async (input, init) => {
    // The RPC client is built on `/`, so it calls `fetch` with a relative
    // URL and a plain init object rather than with a `Request`.
    const method = init?.method ?? 'GET';
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as unknown);
    options.calls?.push({method, url: String(input), body});
    if (method === 'GET') {
      return jsonResponse([TOKYO]);
    }
    const status = options.status ?? 200;
    return jsonResponse(status < 400 ? TOKYO : {error: 'nope'}, status);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    url: new URL('http://localhost/admin/regions'),
  } as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` either action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.create>[0] {
  return {
    fetch: fetchImpl,
    url: new URL('http://localhost/admin/regions'),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.create>[0];
}

function createFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('slug', 'osaka');
  formData.set('name', '大阪');
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value);
  }
  return formData;
}

describe('admin regions +page.server load', () => {
  it('returns the regions the API lists', async () => {
    await expect(load(buildLoadEvent(fakeFetch({})))).resolves.toEqual({
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

describe('admin regions create action', () => {
  it('sends the submitted region and reports the save', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({status: 201, calls}),
      createFormData({allowsDualEntry: 'on'}),
    );

    await expect(actions.create(event)).resolves.toMatchObject({
      intent: 'create',
      saved: true,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/regions',
        body: {slug: 'osaka', name: '大阪', allowsDualEntry: true},
      },
    ]);
  });

  it('defaults an unchecked dual-entry box to false', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({status: 201, calls}),
      createFormData(),
    );

    await expect(actions.create(event)).resolves.toMatchObject({saved: true});
    expect(calls[0].body).toMatchObject({allowsDualEntry: false});
  });

  it('the create action reports a duplicate slug on the slug field', async () => {
    const event = buildActionEvent(fakeFetch({status: 409}), createFormData());

    await expect(actions.create(event)).resolves.toMatchObject({
      status: 409,
      data: {
        intent: 'create',
        fieldErrors: {slug: ['この slug は既に使われています']},
        // Re-rendered so the staff member only has to change the slug.
        values: {slug: 'osaka', name: '大阪'},
      },
    });
  });

  it('marks a malformed slug without asking the API', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({calls}),
      createFormData({slug: 'Tokyo Region'}),
    );

    const result = await actions.create(event);

    expect(result).toMatchObject({status: 400, data: {intent: 'create'}});
    expect(calls).toEqual([]);
  });
});

describe('admin regions update action', () => {
  it('patches only the editable fields of the named region', async () => {
    const calls: ApiCall[] = [];
    const formData = new FormData();
    formData.set('id', TOKYO.id);
    formData.set('name', '東京都');
    formData.set('allowsDualEntry', 'on');
    const event = buildActionEvent(fakeFetch({calls}), formData);

    await expect(actions.update(event)).resolves.toMatchObject({
      intent: 'update',
      regionId: TOKYO.id,
      saved: true,
    });
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `/api/regions/${TOKYO.id}`,
        body: {name: '東京都', allowsDualEntry: true},
      },
    ]);
  });

  it('attaches a failure to the row it came from', async () => {
    const formData = new FormData();
    formData.set('id', TOKYO.id);
    formData.set('name', '東京都');
    const event = buildActionEvent(fakeFetch({status: 404}), formData);

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 404,
      data: {
        intent: 'update',
        regionId: TOKYO.id,
        error: '地域が見つかりません',
      },
    });
  });
});
