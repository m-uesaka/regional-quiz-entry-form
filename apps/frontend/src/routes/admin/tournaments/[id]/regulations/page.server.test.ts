import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError} from '@sveltejs/kit';
import type {Regulation, Tournament} from '@regional-quiz/shared';
import type {RegulationRowValues} from '$lib/types/regulation-form';
import {actions, load} from './+page.server';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000001';

// `load` reads the tournament list alongside the regulations: the gate in
// front of the regulations endpoint answers an expired session with 403, so
// the staff-only list is what surfaces the 401 a login redirect needs.
const TOURNAMENT: Tournament = {
  id: TOURNAMENT_ID,
  regionId: '00000000-0000-0000-0000-000000000021',
  type: 'saikyoi',
  name: '第1回テスト最強位',
  capacity: 64,
  entryOpensAt: '2026-01-01T00:00:00.000Z',
  entryClosesAt: '2026-02-01T00:00:00.000Z',
  entriesPaused: false,
};

const GENERAL: Regulation = {
  id: '00000000-0000-0000-0000-000000000011',
  tournamentId: TOURNAMENT_ID,
  label: '一般の部',
  priorityStartsAt: null,
  priorityEndsAt: null,
  closesWithPriority: false,
  displayOrder: 0,
};

const STUDENT: Regulation = {
  id: '00000000-0000-0000-0000-000000000012',
  tournamentId: TOURNAMENT_ID,
  label: '学生の部',
  priorityStartsAt: '2026-04-01T00:00:00.000Z',
  priorityEndsAt: '2026-04-30T00:00:00.000Z',
  closesWithPriority: false,
  displayOrder: 1,
};

/** The bodies the action `PUT`s, so a test can assert on the order sent. */
interface FetchLog {
  putBodies: Array<{regulations: Array<Record<string, unknown>>}>;
  /** The bodies the import action `POST`s to the preview API. */
  previewBodies?: Array<Record<string, unknown>>;
}

/**
 * Builds a fake `fetch` answering the regulations API.
 * @param options.putStatus The status to answer the save with.
 * @param options.putError The `{error}` message to answer a refusal with.
 * @param log Collects the saved bodies.
 */
function fakeFetch(
  options: {
    putStatus?: number;
    putError?: string;
    tournaments?: Tournament[];
    regulationsStatus?: number;
    /** The regulations the tournament has stored. */
    stored?: Regulation[];
    /** What the sheet-import preview answers with. */
    preview?: {status?: number; body: unknown};
  } = {},
  log: FetchLog = {putBodies: []},
): typeof fetch {
  return (async (input, init) => {
    if (init?.method === 'PUT') {
      log.putBodies.push(JSON.parse(String(init.body)));
      const status = options.putStatus ?? 200;
      return jsonResponse(
        status < 400 ? {ok: true} : {error: options.putError ?? 'nope'},
        status,
      );
    }
    if (String(input).endsWith('/sheet-import/regulations/preview')) {
      log.previewBodies?.push(JSON.parse(String(init?.body)));
      return jsonResponse(
        options.preview?.body ?? {regulations: []},
        options.preview?.status ?? 200,
      );
    }
    if (String(input).endsWith('/regulations')) {
      const status = options.regulationsStatus ?? 200;
      return status < 400
        ? jsonResponse(options.stored ?? [GENERAL, STUDENT])
        : jsonResponse({error: 'tournament not found'}, status);
    }
    return jsonResponse(options.tournaments ?? [TOURNAMENT]);
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

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    params: {id: TOURNAMENT_ID},
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL(
      `http://localhost/admin/tournaments/${TOURNAMENT_ID}/regulations`,
    ),
  } as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` the save action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.save>[0] {
  return {
    params: {id: TOURNAMENT_ID},
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL(
      `http://localhost/admin/tournaments/${TOURNAMENT_ID}/regulations`,
    ),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.save>[0];
}

/**
 * Fills in one row of the form the way the page renders it.
 * @param formData The body being built.
 * @param index The row's position in the rendered form.
 * @param row The control values to set.
 */
function setRow(
  formData: FormData,
  index: number,
  row: {
    id?: string;
    order?: string;
    label: string;
    priorityStartsAt?: string;
    priorityEndsAt?: string;
    /** The box as the page renders it; left out, the page had no box. */
    closesWithPriority?: boolean;
    remove?: boolean;
  },
): void {
  formData.set(`regulations[${index}].id`, row.id ?? '');
  formData.set(`regulations[${index}].order`, row.order ?? String(index + 1));
  formData.set(`regulations[${index}].label`, row.label);
  formData.set(
    `regulations[${index}].priorityStartsAt`,
    row.priorityStartsAt ?? '',
  );
  formData.set(
    `regulations[${index}].priorityEndsAt`,
    row.priorityEndsAt ?? '',
  );
  if (row.closesWithPriority !== undefined) {
    formData.set(`regulations[${index}].closesWithPriorityControl`, '1');
  }
  if (row.closesWithPriority) {
    formData.set(`regulations[${index}].closesWithPriority`, 'on');
  }
  if (row.remove) formData.set(`regulations[${index}].remove`, 'on');
}

describe('admin regulations +page.server load', () => {
  it("returns the tournament's regulations", async () => {
    await expect(load(buildLoadEvent(fakeFetch()))).resolves.toEqual({
      regulations: [GENERAL, STUDENT],
    });
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = (async () =>
      jsonResponse({error: 'boom'}, 500)) as typeof fetch;

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });

  // The gate in front of the regulations endpoint answers an unknown id with
  // 404, which has to be told apart from a backend that is merely down —
  // otherwise a stale or mistyped `[id]` reads as a bad gateway.
  it('reports the 404 the regulations gate answers as not found', async () => {
    await expect(
      load(buildLoadEvent(fakeFetch({regulationsStatus: 404}))),
    ).rejects.toMatchObject({status: 404} satisfies Partial<HttpError>);
  });

  it('reports an id absent from the tournament list as not found', async () => {
    await expect(
      load(buildLoadEvent(fakeFetch({tournaments: []}))),
    ).rejects.toMatchObject({status: 404} satisfies Partial<HttpError>);
  });
});

describe('admin regulations save action', () => {
  it('the save action sends the rows in the displayed order', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    // Rendered second but asked to move to the top, and the browser
    // serializes the rows in the order they appear — so only the numbers
    // can put them right.
    setRow(formData, 0, {id: GENERAL.id, order: '2', label: '一般の部'});
    setRow(formData, 1, {id: STUDENT.id, order: '1', label: '学生の部'});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations.map(r => r.label)).toEqual([
      '学生の部',
      '一般の部',
    ]);
  });

  // The page tells staff to move a row by rewriting its number, and the only
  // number that puts a row at the top is `1` — which the row already there
  // still carries. Ties therefore have to favour the row that was rewritten,
  // or the front position is the one place nothing can ever be moved to.
  it('moves a row to the front when the row already there was left alone', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部'});
    setRow(formData, 1, {label: '新設の部'});
    setRow(formData, 2, {id: STUDENT.id, order: '1', label: '学生の部'});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations.map(r => r.label)).toEqual([
      '学生の部',
      '一般の部',
      '新設の部',
    ]);
  });

  it('keeps the rendered order when nobody renumbered anything', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    // Set out of order on purpose: the index decides, not the body order.
    setRow(formData, 1, {id: STUDENT.id, label: '学生の部'});
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部'});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations).toEqual([
      {
        id: GENERAL.id,
        label: '一般の部',
        priorityStartsAt: null,
        priorityEndsAt: null,
      },
      {
        id: STUDENT.id,
        label: '学生の部',
        priorityStartsAt: null,
        priorityEndsAt: null,
      },
    ]);
  });

  it('adds a row that carries no id and drops the blank one', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部'});
    setRow(formData, 1, {label: '新設の部'});
    // The blank row the page always renders under the others.
    setRow(formData, 2, {label: ''});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations).toEqual([
      {
        id: GENERAL.id,
        label: '一般の部',
        priorityStartsAt: null,
        priorityEndsAt: null,
      },
      {
        id: undefined,
        label: '新設の部',
        priorityStartsAt: null,
        priorityEndsAt: null,
      },
    ]);
  });

  it('leaves out a row ticked for removal', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部'});
    setRow(formData, 1, {id: STUDENT.id, label: '学生の部', remove: true});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations.map(r => r.label)).toEqual([
      '一般の部',
    ]);
  });

  it('sends a priority window as an instant, reading the form as JST', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {
      id: STUDENT.id,
      label: '学生の部',
      priorityStartsAt: '2026-04-01T09:00',
      priorityEndsAt: '2026-04-30T09:00',
    });
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations[0]).toMatchObject({
      priorityStartsAt: '2026-04-01T00:00:00.000Z',
      priorityEndsAt: '2026-04-30T00:00:00.000Z',
    });
  });

  describe('the 優先期間の終了後は選択肢から外す box', () => {
    const WINDOW = {
      priorityStartsAt: '2026-04-01T09:00',
      priorityEndsAt: '2026-04-30T09:00',
    };

    async function savedRow(closesWithPriority?: boolean) {
      const log: FetchLog = {putBodies: []};
      const formData = new FormData();
      setRow(formData, 0, {
        id: STUDENT.id,
        label: '学生の部',
        ...WINDOW,
        closesWithPriority,
      });
      const event = buildActionEvent(fakeFetch({}, log), formData);

      await expect(actions.save(event)).resolves.toMatchObject({saved: true});
      return log.putBodies[0].regulations[0];
    }

    it('sends a ticked box as true', async () => {
      expect((await savedRow(true)).closesWithPriority).toBe(true);
    });

    it('sends a box left unticked as false', async () => {
      expect((await savedRow(false)).closesWithPriority).toBe(false);
    });

    // A page rendered before the box existed and saved after the deploy.
    it('leaves the field out when the form had no box', async () => {
      expect((await savedRow()).closesWithPriority).toBeUndefined();
    });

    it('refuses a ticked box with no priority window', async () => {
      const log: FetchLog = {putBodies: []};
      const formData = new FormData();
      setRow(formData, 0, {label: '一般の部', closesWithPriority: true});
      const event = buildActionEvent(fakeFetch({}, log), formData);

      await expect(actions.save(event)).resolves.toMatchObject({
        status: 400,
        data: {
          error:
            '優先期間の終了後に選択肢から外すには、優先期間を指定してください',
        },
      });
      expect(log.putBodies).toHaveLength(0);
    });
  });

  it('refuses a half-filled priority window without asking the API', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {
      id: GENERAL.id,
      label: '一般の部',
      priorityStartsAt: '2026-04-01T09:00',
    });
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({
      status: 400,
      data: {
        saved: false,
        error: '優先期間は開始と終了の両方を指定してください',
      },
    });
    expect(log.putBodies).toEqual([]);
  });

  it('refuses a set with every row removed, in Japanese', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部', remove: true});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'レギュレーションは1つ以上必要です'},
    });
    expect(log.putBodies).toEqual([]);
  });

  it('refuses a saved row whose name was cleared, in Japanese', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: ''});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.save(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'レギュレーション名を入力してください'},
    });
    expect(log.putBodies).toEqual([]);
  });

  it("the save action surfaces the API's 409 message", async () => {
    const message = 'エントリーに使われているレギュレーションは削除できません';
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部'});
    const event = buildActionEvent(
      fakeFetch({putStatus: 409, putError: message}),
      formData,
    );

    await expect(actions.save(event)).resolves.toMatchObject({
      status: 409,
      data: {saved: false, error: message},
    });
  });

  it('echoes the submitted rows back so a refused save re-renders them', async () => {
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '書き換えた名前'});
    const event = buildActionEvent(fakeFetch({putStatus: 409}), formData);

    await expect(actions.save(event)).resolves.toMatchObject({
      data: {rows: [expect.objectContaining({label: '書き換えた名前'})]},
    });
  });
});

describe('admin regulations import action', () => {
  /** Builds the event for an import of the given spreadsheet ID. */
  function buildImportEvent(
    fetchImpl: typeof fetch,
    spreadsheetId: string,
  ): Parameters<typeof actions.import>[0] {
    const formData = new FormData();
    formData.set('spreadsheetId', spreadsheetId);
    return buildActionEvent(fetchImpl, formData);
  }

  it('pairs sheet rows with stored ones by name and ticks the rest', async () => {
    const log: FetchLog = {putBodies: [], previewBodies: []};
    const event = buildImportEvent(
      fakeFetch(
        {
          preview: {
            body: {
              regulations: [
                {
                  label: '地元の部',
                  priorityStartsAt: '2026-08-01T01:00:00.000Z',
                  priorityEndsAt: '2026-08-08T01:00:00.000Z',
                },
                // Stored with a priority window; the sheet drops it.
                {
                  label: '学生の部',
                  priorityStartsAt: null,
                  priorityEndsAt: null,
                },
              ],
            },
          },
        },
        log,
      ),
      ' sheet-id ',
    );

    await expect(actions.import(event)).resolves.toEqual({
      saved: false,
      imported: true,
      error: null,
      spreadsheetId: 'sheet-id',
      rows: [
        {
          id: '',
          order: '',
          label: '地元の部',
          priorityStartsAt: '2026-08-01T10:00',
          priorityEndsAt: '2026-08-08T10:00',
          closesWithPriority: false,
          remove: false,
        },
        {
          id: STUDENT.id,
          order: '',
          label: '学生の部',
          priorityStartsAt: '',
          priorityEndsAt: '',
          closesWithPriority: false,
          remove: false,
        },
        {
          id: GENERAL.id,
          order: '',
          label: '一般の部',
          priorityStartsAt: '',
          priorityEndsAt: '',
          closesWithPriority: false,
          remove: true,
        },
      ],
    });
    expect(log.previewBodies).toEqual([{spreadsheetId: 'sheet-id'}]);
    // Reading a sheet saves nothing.
    expect(log.putBodies).toEqual([]);
  });

  // The stored setting survives a sheet from before the column; a filled-in
  // cell overrides it.
  it('takes the setting from the sheet, or else from the stored row', async () => {
    const stored = [{...STUDENT, closesWithPriority: true}, GENERAL];
    const window = {
      priorityStartsAt: '2026-08-01T01:00:00.000Z',
      priorityEndsAt: '2026-08-08T01:00:00.000Z',
    };
    const event = buildImportEvent(
      fakeFetch({
        stored,
        preview: {
          body: {
            regulations: [
              {label: '学生の部', ...window},
              {label: '一般の部', ...window, closesWithPriority: true},
              {label: '新しい部', ...window},
            ],
          },
        },
      }),
      'sheet-id',
    );

    const result = await actions.import(event);

    expect(
      (result as {rows: RegulationRowValues[]}).rows.map(row => [
        row.label,
        row.closesWithPriority,
      ]),
    ).toEqual([
      ['学生の部', true],
      ['一般の部', true],
      ['新しい部', false],
    ]);
  });

  it("surfaces the preview API's message and keeps the stored rows", async () => {
    const message = '2行目: 優先期間は開始と終了の両方を指定してください';
    const event = buildImportEvent(
      fakeFetch({preview: {status: 400, body: {error: message}}}),
      'sheet-id',
    );

    await expect(actions.import(event)).resolves.toMatchObject({
      status: 400,
      data: {
        imported: false,
        error: message,
        rows: null,
        spreadsheetId: 'sheet-id',
      },
    });
  });

  it('refuses a blank spreadsheet ID without asking the API', async () => {
    const log: FetchLog = {putBodies: [], previewBodies: []};
    const event = buildImportEvent(fakeFetch({}, log), '  ');

    await expect(actions.import(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'スプレッドシートIDを入力してください'},
    });
    expect(log.previewBodies).toEqual([]);
  });

  it('sends an expired session to the login page', async () => {
    const event = buildImportEvent(
      fakeFetch({preview: {status: 401, body: {error: 'unauthorized'}}}),
      'sheet-id',
    );

    await expect(actions.import(event)).rejects.toMatchObject({status: 303});
  });

  // The two requests run side by side, so the session can expire between
  // them: the preview passes and only the stored read is refused.
  it('sends a session that expired on the stored read to the login page', async () => {
    const event = buildImportEvent(
      fakeFetch({regulationsStatus: 401}),
      'sheet-id',
    );

    await expect(actions.import(event)).rejects.toMatchObject({status: 303});
  });
});
