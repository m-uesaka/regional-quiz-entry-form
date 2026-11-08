import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import {
  ENTRY_PERIOD_ORDER_MESSAGE,
  type FormFieldDef,
  type Region,
  type Tournament,
} from '@regional-quiz/shared';
import {fakeCookies} from '../../../../../test-support/fake-cookies';
import {
  fakeFetch,
  type FakeRoute,
  type RecordedRequest,
} from '../../../../../test-support/fake-fetch';
import {jsonResponse} from '../../../../../test-support/json-response';
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
  entriesPaused: false,
  questionSet: null,
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

const PROMOTION = {promotedCount: 2, mailFailedCount: 0};
const RESET_RESPONSE = {
  deletedEntryCount: 5,
  deletedParticipantCount: 3,
  keptParticipantCount: 1,
};

/**
 * Builds a fake `fetch` answering the regions, tournaments and form
 * definition APIs.
 * @param options.status The status to answer a PATCH, POST or DELETE with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.tournaments The tournaments `GET /api/tournaments/:id` can
 *     find.
 * @param options.calls Collects the requests sent.
 */
function fakeApi(
  options: {
    status?: number;
    error?: string;
    tournaments?: Tournament[];
    calls?: RecordedRequest[];
  } = {},
): typeof fetch {
  const tournaments = options.tournaments ?? [TOURNAMENT];
  const reads: FakeRoute[] = [
    {method: 'GET', url: /^\/api\/regions$/, body: [TOKYO]},
    // Before the `:id` read, whose pattern this path matches too.
    {method: 'GET', url: '/api/tournaments/question-sets', body: ['宮崎']},
    {
      method: 'GET',
      url: /^\/api\/tournaments\/[^/]+$/,
      respond: ({url}) => {
        const tournament = tournaments.find(
          t => url === `/api/tournaments/${t.id}`,
        );
        return tournament
          ? jsonResponse({
              tournament,
              customName: tournament.name,
              formFieldDefs: FORM_FIELD_DEFS,
            })
          : jsonResponse({error: 'tournament not found'}, 404);
      },
    },
  ];
  return fakeFetch(
    [...reads, ...writeRoutes(options.status ?? 200, options.error)],
    options.calls,
  );
}

/** How `fakeApi` answers a PATCH, POST or DELETE with the given status. */
function writeRoutes(status: number, error = 'nope'): FakeRoute[] {
  /** The answer to a write that, succeeding with a body, sends `body`. */
  function answer(body: unknown): {status: number; body?: unknown} {
    if (status === 204) return {status};
    if (status >= 400) return {status, body: {error}};
    return {status, body};
  }
  const path = `/api/tournaments/${TOURNAMENT.id}`;
  return [
    {
      method: 'PATCH',
      url: path,
      ...answer({...TOURNAMENT, promotion: PROMOTION}),
    },
    {method: 'POST', url: `${path}/reset`, ...answer(RESET_RESPONSE)},
    {method: 'DELETE', url: path, ...answer(TOURNAMENT)},
  ];
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
    await expect(load(buildLoadEvent(fakeApi()))).resolves.toEqual({
      tournament: TOURNAMENT,
      customName: TOURNAMENT.name,
      regions: [TOKYO],
      questionSets: ['宮崎'],
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
  // The 問題セット suggestions come from their own read, not the list.
  it('load fetches only the tournament it needs', async () => {
    const calls: RecordedRequest[] = [];

    await load(buildLoadEvent(fakeApi({calls})));

    expect(calls.map(call => `${call.method} ${call.url}`).sort()).toEqual([
      'GET /api/regions',
      `GET /api/tournaments/${TOURNAMENT.id}`,
      'GET /api/tournaments/question-sets',
    ]);
  });

  it('reports an id that is not a UUID as not found, without asking the API', async () => {
    const calls: RecordedRequest[] = [];
    const event = {
      ...buildLoadEvent(fakeApi({calls})),
      params: {id: 'not-a-uuid'},
    } as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
    expect(calls).toEqual([]);
  });

  it('does not mistake another refusal of the API for a missing tournament', async () => {
    const failing = fakeFetch([
      {method: 'GET', url: '/api/regions', body: [TOKYO]},
      {method: 'GET', url: '/api/tournaments/question-sets', body: []},
      {
        method: 'GET',
        url: `/api/tournaments/${TOURNAMENT.id}`,
        status: 400,
        body: {error: 'nope'},
      },
    ]);

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });

  it('reports an id that names no tournament as not found', async () => {
    await expect(
      load(buildLoadEvent(fakeApi({tournaments: []}))),
    ).rejects.toMatchObject({status: 404} satisfies Partial<HttpError>);
  });
});

describe('admin tournament update action', () => {
  // Sent from the server, not the browser: `/api/*` is only routed to the
  // backend Worker for requests the frontend makes itself, so a client-side
  // PATCH 404s in production.
  it('updates the tournament, reading the entry window as JST', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      updateFormData({name: '改題した最強位'}),
    );

    // What the save did to the waitlist is handed to the page (#223).
    await expect(actions.update(event)).resolves.toMatchObject({
      saved: true,
      promotion: PROMOTION,
    });
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
          questionSet: null,
        },
      },
    ]);
  });

  it('saves the 問題セット typed, and a blank one as the common questions', async () => {
    const calls: RecordedRequest[] = [];

    await actions.update(
      buildActionEvent(
        fakeApi({calls}),
        updateFormData({questionSet: '鹿児島'}),
      ),
    );
    await actions.update(
      buildActionEvent(fakeApi({calls}), updateFormData({questionSet: ' '})),
    );

    expect(
      calls.map(call => (call.body as {questionSet: unknown}).questionSet),
    ).toEqual(['鹿児島', null]);
  });

  it('names a space inside the 問題セット, re-rendering what was typed', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      updateFormData({questionSet: '宮 崎'}),
    );

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error: '問題セットに空白は使えません',
        values: {questionSet: '宮 崎'},
      },
    });
    expect(calls).toEqual([]);
  });

  // #285: the period is checked here by the API's own rule, so the
  // mistake is named rather than refused at large.
  for (const entryClosesAt of ['2026-01-01T09:00', '2025-12-31T09:00']) {
    it(`names an entry period closing at ${entryClosesAt}, without asking the API`, async () => {
      const calls: RecordedRequest[] = [];
      const event = buildActionEvent(
        fakeApi({calls}),
        updateFormData({entryClosesAt}),
      );

      await expect(actions.update(event)).resolves.toMatchObject({
        status: 400,
        data: {
          error: ENTRY_PERIOD_ORDER_MESSAGE,
          values: {entryClosesAt},
        },
      });
      expect(calls).toEqual([]);
    });
  }

  it('refuses a form the API would reject, without asking it', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      updateFormData({entryOpensAt: ''}),
    );

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 400,
      data: {saved: false, error: '入力内容を確認してください'},
    });
    expect(calls).toEqual([]);
  });

  it('reports a tournament that has since been removed', async () => {
    const event = buildActionEvent(fakeApi({status: 404}), updateFormData());

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 404,
      data: {error: '大会が見つかりません'},
    });
  });

  it("surfaces the API's own refusal and re-renders what was typed", async () => {
    const event = buildActionEvent(
      fakeApi({status: 400, error: 'insert or update violates foreign key'}),
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

  it('surfaces a duplicate tournament, which the API answers with 409', async () => {
    const event = buildActionEvent(
      fakeApi({
        status: 409,
        error: 'この地域には同じ種別の大会がすでにあります',
      }),
      updateFormData({name: '書きかけの大会名'}),
    );

    await expect(actions.update(event)).resolves.toMatchObject({
      status: 409,
      data: {
        error: 'この地域には同じ種別の大会がすでにあります',
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
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({status: 204, calls}),
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
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(fakeApi({calls}), deleteFormData(false));

    await expect(actions.delete(event)).resolves.toMatchObject({
      status: 400,
      data: {deleteError: '削除の確認にチェックを入れてください'},
    });
    expect(calls).toEqual([]);
  });

  it("surfaces the API's refusal of a tournament that has entries", async () => {
    const event = buildActionEvent(
      fakeApi({status: 409, error: 'エントリーがある大会は削除できません'}),
      deleteFormData(),
    );

    await expect(actions.delete(event)).resolves.toMatchObject({
      status: 409,
      data: {deleteError: 'エントリーがある大会は削除できません'},
    });
  });

  it('reports a tournament that is already gone', async () => {
    const event = buildActionEvent(fakeApi({status: 404}), deleteFormData());

    await expect(actions.delete(event)).resolves.toMatchObject({
      status: 404,
      data: {deleteError: '大会が見つかりません'},
    });
  });
});

describe('admin tournament reset action', () => {
  function resetFormData(
    fields: {participants?: string; confirmation?: string} = {},
  ): FormData {
    const formData = new FormData();
    const {participants = 'delete', confirmation = 'リセット'} = fields;
    formData.set('participants', participants);
    formData.set('confirmation', confirmation);
    return formData;
  }

  it('resets the entries, deleting the accounts when asked to', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(fakeApi({calls}), resetFormData());

    await expect(actions.reset(event)).resolves.toEqual({
      reset: RESET_RESPONSE,
      resetError: null,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/tournaments/${TOURNAMENT.id}/reset`,
        body: {deleteParticipants: true},
      },
    ]);
  });

  it('keeps the accounts when asked to', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      resetFormData({participants: 'keep'}),
    );

    await actions.reset(event);

    expect(calls.map(c => c.body)).toEqual([{deleteParticipants: false}]);
  });

  it('refuses a post that chose nothing about the accounts, without asking the API', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      resetFormData({participants: ''}),
    );

    await expect(actions.reset(event)).resolves.toMatchObject({
      status: 400,
      data: {resetError: '参加者アカウントを残すか削除するかを選んでください'},
    });
    expect(calls).toEqual([]);
  });

  it('refuses a post without the typed confirmation, without asking the API', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      resetFormData({confirmation: 'りせっと'}),
    );

    await expect(actions.reset(event)).resolves.toMatchObject({
      status: 400,
      data: {resetError: '確認のため「リセット」と入力してください'},
    });
    expect(calls).toEqual([]);
  });

  it('takes the word as an IME may leave it, half-width or with a trailing space', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      resetFormData({confirmation: 'ﾘｾｯﾄ\u3000'}),
    );

    await expect(actions.reset(event)).resolves.toMatchObject({
      reset: RESET_RESPONSE,
    });
    expect(calls).toHaveLength(1);
  });

  it("surfaces the API's refusal of a tournament in its entry period", async () => {
    const event = buildActionEvent(
      fakeApi({
        status: 409,
        error: 'エントリー期間中の大会はリセットできません',
      }),
      resetFormData(),
    );

    await expect(actions.reset(event)).resolves.toMatchObject({
      status: 409,
      data: {resetError: 'エントリー期間中の大会はリセットできません'},
    });
  });

  it('says a refused permission is one, not a failure', async () => {
    const event = buildActionEvent(fakeApi({status: 403}), resetFormData());

    await expect(actions.reset(event)).resolves.toMatchObject({
      status: 403,
      data: {resetError: '参加者データをリセットする権限がありません'},
    });
  });

  it('reports a tournament that is gone', async () => {
    const event = buildActionEvent(fakeApi({status: 404}), resetFormData());

    await expect(actions.reset(event)).resolves.toMatchObject({
      status: 404,
      data: {resetError: '大会が見つかりません'},
    });
  });

  it('reports any other failure without passing the API message on', async () => {
    const event = buildActionEvent(
      fakeApi({status: 500, error: 'internal server error'}),
      resetFormData(),
    );

    await expect(actions.reset(event)).resolves.toMatchObject({
      status: 502,
      data: {resetError: '参加者データのリセットに失敗しました'},
    });
  });
});
