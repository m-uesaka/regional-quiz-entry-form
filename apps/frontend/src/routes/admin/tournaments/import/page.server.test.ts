import {describe, expect, it} from 'vitest';
import type {Redirect} from '@sveltejs/kit';
import type {
  Region,
  TournamentImportPreviewRow,
  TournamentImportResult,
} from '@regional-quiz/shared';
import {fakeCookies} from '../../../../test-support/fake-cookies';
import {
  fakePlatform,
  TOKYO_SAIKYOI_LIST_KEY,
} from '../../../../test-support/fake-platform';
import {
  fakeFetch,
  type RecordedRequest,
} from '../../../../test-support/fake-fetch';
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
  promotion: {promotedCount: 0, mailFailedCount: 0},
};

const PREVIEW_ROW: TournamentImportPreviewRow = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  action: 'create',
  fingerprint: 'fp-1',
  error: null,
  capacity: 54,
  entryOpensAt: '2026-11-04T12:00:00.000Z',
  entryClosesAt: '2026-12-16T14:59:59.000Z',
  formFieldLabels: ['備考'],
  regulationLabels: ['一般'],
  current: null,
};

const SELECTION = {
  regionName: '北海道',
  typeLabel: '最強位',
  action: 'create',
  fingerprint: 'fp-1',
};

/**
 * Builds a fake `fetch` answering the sheet-import API.
 * @param options.status The status to answer with.
 * @param options.body The body to answer with.
 * @param options.calls Collects the requests sent.
 */
function fakeApi(
  options: {status?: number; body?: unknown; calls?: RecordedRequest[]} = {},
): typeof fetch {
  const answer = {
    status: options.status ?? 200,
    body: options.body ?? {results: [CREATED]},
  };
  // The preview and the registration answer alike.
  return fakeFetch(
    [
      {
        method: 'POST',
        url: '/api/sheet-import/tournaments/preview',
        ...answer,
      },
      {method: 'POST', url: /^\/api\/sheet-import\/tournaments$/, ...answer},
    ],
    options.calls,
  );
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
    cookies: fakeCookies(deletedCookies),
    url: new URL('http://localhost/admin/tournaments/import'),
    request: {formData: async () => formData},
  } as ActionEvent;
}

describe('admin tournament import preview action', () => {
  it('sends the ID out of a pasted URL and hands back every row', async () => {
    const calls: RecordedRequest[] = [];
    const url = 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=0';

    await expect(
      actions.preview(
        buildEvent(fakeApi({calls, body: {rows: [PREVIEW_ROW]}}), url),
      ),
    ).resolves.toEqual({
      spreadsheetId: url,
      error: null,
      rows: [PREVIEW_ROW],
      results: null,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/sheet-import/tournaments/preview',
        body: {spreadsheetId: 'abc123'},
      },
    ]);
  });

  it('refuses an empty field without asking the API', async () => {
    const calls: RecordedRequest[] = [];

    await expect(
      actions.preview(buildEvent(fakeApi({calls}), '  ')),
    ).resolves.toMatchObject({
      status: 400,
      data: {error: 'スプレッドシートの ID または URL を入力してください'},
    });
    expect(calls).toEqual([]);
  });

  it("shows the API's reason when the sheet can't be used", async () => {
    const event = buildEvent(
      fakeApi({
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
      fakeApi({status: 401, body: {error: 'unauthorized'}}),
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
    const calls: RecordedRequest[] = [];

    await expect(
      actions.execute(
        buildEvent(fakeApi({calls}), 'abc123', [], [JSON.stringify(SELECTION)]),
      ),
    ).resolves.toEqual({
      spreadsheetId: 'abc123',
      error: null,
      rows: null,
      results: [CREATED],
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/sheet-import/tournaments',
        body: {spreadsheetId: 'abc123', selections: [SELECTION]},
      },
    ]);
  });

  it('refuses to register nothing without asking the API', async () => {
    const calls: RecordedRequest[] = [];

    await expect(
      actions.execute(buildEvent(fakeApi({calls}), 'abc123')),
    ).resolves.toMatchObject({
      status: 400,
      data: {error: '登録する大会を選んでください'},
    });
    expect(calls).toEqual([]);
  });

  it('refuses a selection that was tampered with', async () => {
    const calls: RecordedRequest[] = [];

    await expect(
      actions.execute(
        buildEvent(
          fakeApi({calls}),
          'abc123',
          [],
          [JSON.stringify({...SELECTION, action: 'delete'})],
        ),
      ),
    ).resolves.toMatchObject({status: 400});
    expect(calls).toEqual([]);
  });

  it("says the choice was refused when the API's validation rejects it", async () => {
    const event = buildEvent(
      fakeApi({status: 400, body: {error: 'invalid request'}}),
      'abc123',
      [],
      [JSON.stringify(SELECTION)],
    );

    await expect(actions.execute(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error: '選択した大会を登録できませんでした。もう一度読み込んでください',
      },
    });
  });

  it('reports an internal failure as one to retry', async () => {
    const event = buildEvent(
      fakeApi({status: 500, body: {error: 'internal server error'}}),
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

describe('admin tournament import execute action and the public list cache (#307)', () => {
  const TOKYO: Region = {
    id: '00000000-0000-0000-0000-000000000011',
    slug: 'tokyo',
    name: '東京',
    allowsDualEntry: false,
  };
  /** An overwrite of tokyo / saikyoi whose capacity promoted two. */
  const OVERWRITTEN: TournamentImportResult = {
    ...CREATED,
    regionName: TOKYO.name,
    outcome: 'updated',
    promotion: {promotedCount: 2, mailFailedCount: 0},
  };

  /**
   * Registers with a cached tokyo / saikyoi list, the API answering with
   * `results` and the regions with `regions` (or `regionsStatus`).
   */
  async function execute(
    results: TournamentImportResult[],
    options: {regions?: Region[]; regionsStatus?: number} = {},
  ) {
    const calls: RecordedRequest[] = [];
    const {platform, stored} = fakePlatform();
    stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json('v1'));
    const regionsStatus = options.regionsStatus ?? 200;
    const fetchImpl = fakeFetch(
      [
        {
          method: 'POST',
          url: /^\/api\/sheet-import\/tournaments$/,
          body: {results},
        },
        {
          method: 'GET',
          url: /^\/api\/regions$/,
          status: regionsStatus,
          body:
            regionsStatus === 200
              ? (options.regions ?? [TOKYO])
              : {error: 'nope'},
        },
      ],
      calls,
    );
    const result = await actions.execute({
      ...buildEvent(fetchImpl, 'abc123', [], [JSON.stringify(SELECTION)]),
      platform,
    });
    return {result, calls, stored};
  }

  it('drops the list of an overwrite that promoted the waitlist', async () => {
    const {result, calls, stored} = await execute([CREATED, OVERWRITTEN]);

    expect(result).toMatchObject({results: [CREATED, OVERWRITTEN]});
    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(false);
    // One read of the regions, whatever the number of rows.
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST /api/sheet-import/tournaments',
      'GET /api/regions',
    ]);
  });

  it('drops the list of an overwrite whose promotion failed', async () => {
    const {stored} = await execute([{...OVERWRITTEN, promotion: null}]);

    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(false);
  });

  it('reads nothing more when no overwrite promoted anyone', async () => {
    const {calls, stored} = await execute([
      CREATED,
      {...OVERWRITTEN, promotion: {promotedCount: 0, mailFailedCount: 0}},
      {...OVERWRITTEN, outcome: 'failed', type: null, promotion: null},
    ]);

    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(true);
    expect(calls.map(c => c.method)).toEqual(['POST']);
  });

  it('leaves a region name more than one region has alone', async () => {
    const {stored} = await execute([OVERWRITTEN], {
      regions: [
        TOKYO,
        {...TOKYO, id: '00000000-0000-0000-0000-000000000012', slug: 'tokyo2'},
      ],
    });

    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(true);
  });

  it('still hands back the results when the regions cannot be read', async () => {
    const {result, stored} = await execute([OVERWRITTEN], {
      regionsStatus: 500,
    });

    expect(result).toMatchObject({error: null, results: [OVERWRITTEN]});
    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(true);
  });
});
