import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import type {
  TournamentImportPreviewRow,
  TournamentImportResult,
} from '@regional-quiz/shared';
import {actions} from './+page.server';

const CREATED: TournamentImportResult = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  outcome: 'created',
  tournamentId: '00000000-0000-0000-0000-000000000021',
  type: 'saikyoi',
  capacity: 54,
  entryOpensAt: '2026-11-04T12:00:00.000Z',
  entryClosesAt: '2026-12-16T14:59:59.000Z',
  error: null,
};

const PREVIEW_ROW: TournamentImportPreviewRow = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  action: 'create',
  error: null,
  capacity: 54,
  entryOpensAt: '2026-11-04T12:00:00.000Z',
  entryClosesAt: '2026-12-16T14:59:59.000Z',
  formFieldLabels: ['備考'],
  regulationLabels: ['一般'],
  current: null,
};

const SELECTION = {regionName: '北海道', typeLabel: '最強位', action: 'create'};

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

type ActionEvent = Parameters<typeof actions.preview>[0];

function buildEvent(
  fetchImpl: typeof fetch,
  spreadsheetId: string,
  deletedCookies: string[] = [],
  selections: string[] = [],
): ActionEvent {
  const formData = new FormData();
  formData.set('spreadsheetId', spreadsheetId);
  for (const selection of selections) {
    formData.append('selection', selection);
  }
  return {
    fetch: fetchImpl,
    cookies: {
      delete: (name: string) => {
        deletedCookies.push(name);
      },
    } as unknown as Cookies,
    url: new URL('http://localhost/admin/tournaments/import'),
    request: {formData: async () => formData},
  } as ActionEvent;
}

describe('admin tournament import preview action', () => {
  it('sends the ID out of a pasted URL and hands back every row', async () => {
    const calls: ApiCall[] = [];
    const url = 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=0';

    await expect(
      actions.preview(
        buildEvent(fakeFetch({calls, body: {rows: [PREVIEW_ROW]}}), url),
      ),
    ).resolves.toEqual({
      spreadsheetId: url,
      error: null,
      rows: [PREVIEW_ROW],
      results: null,
    });
    expect(calls).toEqual([
      {
        url: '/api/sheet-import/tournaments/preview',
        body: {spreadsheetId: 'abc123'},
      },
    ]);
  });

  it('refuses an empty field without asking the API', async () => {
    const calls: ApiCall[] = [];

    await expect(
      actions.preview(buildEvent(fakeFetch({calls}), '  ')),
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
        body: {error: '1行目に「定員」の列が見つかりません'},
      }),
      'abc123',
    );

    await expect(actions.preview(event)).resolves.toMatchObject({
      status: 400,
      data: {
        spreadsheetId: 'abc123',
        error: '1行目に「定員」の列が見つかりません',
        rows: null,
        results: null,
      },
    });
  });

  it('sends an expired session to the login form', async () => {
    const deleted: string[] = [];
    const event = buildEvent(
      fakeFetch({status: 401, body: {error: 'unauthorized'}}),
      'abc123',
      deleted,
    );

    await expect(actions.preview(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fadmin%2Ftournaments%2Fimport',
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual(['staff_session']);
  });
});

describe('admin tournament import execute action', () => {
  it('sends the chosen tournaments and hands back the results', async () => {
    const calls: ApiCall[] = [];

    await expect(
      actions.execute(
        buildEvent(
          fakeFetch({calls}),
          'abc123',
          [],
          [JSON.stringify(SELECTION)],
        ),
      ),
    ).resolves.toEqual({
      spreadsheetId: 'abc123',
      error: null,
      rows: null,
      results: [CREATED],
    });
    expect(calls).toEqual([
      {
        url: '/api/sheet-import/tournaments',
        body: {spreadsheetId: 'abc123', selections: [SELECTION]},
      },
    ]);
  });

  it('refuses to register nothing without asking the API', async () => {
    const calls: ApiCall[] = [];

    await expect(
      actions.execute(buildEvent(fakeFetch({calls}), 'abc123')),
    ).resolves.toMatchObject({
      status: 400,
      data: {error: '登録する大会を選んでください'},
    });
    expect(calls).toEqual([]);
  });

  it('refuses a selection that was tampered with', async () => {
    const calls: ApiCall[] = [];

    await expect(
      actions.execute(
        buildEvent(
          fakeFetch({calls}),
          'abc123',
          [],
          [JSON.stringify({...SELECTION, action: 'delete'})],
        ),
      ),
    ).resolves.toMatchObject({status: 400});
    expect(calls).toEqual([]);
  });

  it('reports an internal failure as one to retry', async () => {
    const event = buildEvent(
      fakeFetch({status: 500, body: {error: 'internal server error'}}),
      'abc123',
      [],
      [JSON.stringify(SELECTION)],
    );

    await expect(actions.execute(event)).resolves.toMatchObject({
      status: 502,
      data: {error: '一括登録に失敗しました。時間をおいて再度お試しください'},
    });
  });
});
