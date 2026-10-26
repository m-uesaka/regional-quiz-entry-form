import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError} from '@sveltejs/kit';
import type {FormFieldDef, Region, Tournament} from '@regional-quiz/shared';
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

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {
    fieldKey: 'note',
    label: '備考',
    plainLabel: '備考',
    fieldType: 'textarea',
    required: false,
    options: null,
    displayOrder: 0,
  },
];

/** One request an action put on the wire. */
interface ApiCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Builds a fake `fetch` answering the regions, tournaments and form
 * definition APIs.
 * @param options.status The status to answer a PATCH or DELETE with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.tournaments The tournaments `GET /api/tournaments/:id` can
 *     find.
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
      if (url.includes('/regions')) {
        return jsonResponse([TOKYO]);
      }
      const tournament = (options.tournaments ?? [TOURNAMENT]).find(
        t => url === `/api/tournaments/${t.id}`,
      );
      return tournament
        ? jsonResponse({
            tournament,
            customName: tournament.name,
            formFieldDefs: FORM_FIELD_DEFS,
          })
        : jsonResponse({error: 'tournament not found'}, 404);
    }
    const status = options.status ?? 200;
    if (status === 204) {
      return new Response(null, {status});
    }
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

/**
 * A stand-in for `event.cookies`, recording the names deleted on it: a
 * session the API refuses is dropped on the way to the login screen.
 * @param deleted Collects the deleted cookie names.
 */
function fakeCookies(deleted: string[] = []): Cookies {
  return {
    delete: (name: string) => {
      deleted.push(name);
    },
  } as unknown as Cookies;
}

function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    params: {id: TOURNAMENT.id},
    fetch: fetchImpl,
    cookies: fakeCookies(),
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
    cookies: fakeCookies(),
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
      customName: TOURNAMENT.name,
      regions: [TOKYO],
      formDefinitionYaml:
        'tournamentSlug: saikyoi\n' +
        'fields:\n' +
        '  - key: note\n' +
        '    label: 備考\n' +
        '    type: textarea\n' +
        '    required: false\n',
    });
  });

  // Not the whole list to `find` the one being edited in (#123), and its
  // form fields with it rather than through the entry-period-gated read.
  it('load fetches only the tournament it needs', async () => {
    const calls: ApiCall[] = [];

    await load(buildLoadEvent(fakeFetch({calls})));

    expect(calls.map(call => `${call.method} ${call.url}`).sort()).toEqual([
      'GET /api/regions',
      `GET /api/tournaments/${TOURNAMENT.id}`,
    ]);
  });

  it('reports an id that is not a UUID as not found, without asking the API', async () => {
    const calls: ApiCall[] = [];
    const event = {
      ...buildLoadEvent(fakeFetch({calls})),
      params: {id: 'not-a-uuid'},
    } as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
    expect(calls).toEqual([]);
  });

  it('does not mistake another refusal of the API for a missing tournament', async () => {
    const failing = (async () =>
      jsonResponse({error: 'nope'}, 400)) as unknown as typeof fetch;

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
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

describe('admin tournament delete action', () => {
  function deleteFormData(confirmed = true): FormData {
    const formData = new FormData();
    if (confirmed) {
      formData.set('confirm', 'on');
    }
    return formData;
  }

  it('deletes the tournament and lands on the tournament list', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({status: 204, calls}),
      deleteFormData(),
    );

    await expect(actions.delete(event)).rejects.toMatchObject({
      status: 303,
      location: '/admin/tournaments?deleted',
    });
    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: `/api/tournaments/${TOURNAMENT.id}`,
        body: undefined,
      },
    ]);
  });

  it('refuses a post without the confirmation, without asking the API', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(fakeFetch({calls}), deleteFormData(false));

    await expect(actions.delete(event)).resolves.toMatchObject({
      status: 400,
      data: {deleteError: '削除の確認にチェックを入れてください'},
    });
    expect(calls).toEqual([]);
  });

  it("surfaces the API's refusal of a tournament that has entries", async () => {
    const event = buildActionEvent(
      fakeFetch({status: 409, error: 'エントリーがある大会は削除できません'}),
      deleteFormData(),
    );

    await expect(actions.delete(event)).resolves.toMatchObject({
      status: 409,
      data: {deleteError: 'エントリーがある大会は削除できません'},
    });
  });

  it('reports a tournament that is already gone', async () => {
    const event = buildActionEvent(fakeFetch({status: 404}), deleteFormData());

    await expect(actions.delete(event)).resolves.toMatchObject({
      status: 404,
      data: {deleteError: '大会が見つかりません'},
    });
  });
});
