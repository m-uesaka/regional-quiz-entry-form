import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import type {TournamentImportResult} from '@regional-quiz/shared';
import {actions} from './+page.server';

const CREATED: TournamentImportResult = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  outcome: 'created',
  tournamentId: '00000000-0000-0000-0000-000000000021',
  type: 'saikyoi',
  entryOpensAt: '2026-11-01T00:00:00.000Z',
  entryClosesAt: '2026-12-25T14:59:00.000Z',
  error: null,
};

/** One request the action put on the wire. */
interface ApiCall {
  url: string;
  body: unknown;
}

function fakeFetch(
  options: {status?: number; body?: unknown; calls?: ApiCall[]} = {},
): typeof fetch {
  return (async (input, init) => {
    options.calls?.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as unknown,
    });
    return new Response(JSON.stringify(options.body ?? {results: [CREATED]}), {
      status: options.status ?? 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

function buildEvent(
  fetchImpl: typeof fetch,
  spreadsheetId: string,
  deletedCookies: string[] = [],
): Parameters<typeof actions.default>[0] {
  const formData = new FormData();
  formData.set('spreadsheetId', spreadsheetId);
  return {
    fetch: fetchImpl,
    cookies: {
      delete: (name: string) => {
        deletedCookies.push(name);
      },
    } as unknown as Cookies,
    url: new URL('http://localhost/admin/tournaments/import'),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

describe('admin tournament import action', () => {
  it('sends the ID out of a pasted URL and hands back every row', async () => {
    const calls: ApiCall[] = [];
    const url = 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=0';

    await expect(
      actions.default(buildEvent(fakeFetch({calls}), url)),
    ).resolves.toEqual({spreadsheetId: url, error: null, results: [CREATED]});
    expect(calls).toEqual([
      {url: '/api/sheet-import/tournaments', body: {spreadsheetId: 'abc123'}},
    ]);
  });

  it('refuses an empty field without asking the API', async () => {
    const calls: ApiCall[] = [];

    await expect(
      actions.default(buildEvent(fakeFetch({calls}), '  ')),
    ).resolves.toMatchObject({
      status: 400,
      data: {error: 'スプレッドシートの ID または URL を入力してください'},
    });
    expect(calls).toEqual([]);
  });

  it("shows the API's reason when the sheet can't be used", async () => {
    const event = buildEvent(
      fakeFetch({
        status: 400,
        body: {error: '1行目に「地域」の列が見つかりません'},
      }),
      'abc123',
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        spreadsheetId: 'abc123',
        error: '1行目に「地域」の列が見つかりません',
        results: null,
      },
    });
  });

  it('reports an internal failure as one to retry', async () => {
    const event = buildEvent(
      fakeFetch({status: 500, body: {error: 'internal server error'}}),
      'abc123',
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 502,
      data: {error: '一括登録に失敗しました。時間をおいて再度お試しください'},
    });
  });

  it('sends an expired session to the login form', async () => {
    const deleted: string[] = [];
    const event = buildEvent(
      fakeFetch({status: 401, body: {error: 'unauthorized'}}),
      'abc123',
      deleted,
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fadmin%2Ftournaments%2Fimport',
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual(['staff_session']);
  });
});
