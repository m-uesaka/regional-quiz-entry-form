import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Regulation} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000001';

const GENERAL: Regulation = {
  id: '00000000-0000-0000-0000-000000000011',
  tournamentId: TOURNAMENT_ID,
  label: '一般の部',
  priorityStartsAt: null,
  priorityEndsAt: null,
  displayOrder: 0,
};

const STUDENT: Regulation = {
  id: '00000000-0000-0000-0000-000000000012',
  tournamentId: TOURNAMENT_ID,
  label: '学生の部',
  priorityStartsAt: '2026-04-01T00:00:00.000Z',
  priorityEndsAt: '2026-04-30T00:00:00.000Z',
  displayOrder: 1,
};

/** The bodies the action `PUT`s, so a test can assert on the order sent. */
interface FetchLog {
  putBodies: Array<{regulations: Array<Record<string, unknown>>}>;
}

/**
 * Builds a fake `fetch` answering the regulations API.
 * @param options.putStatus The status to answer the save with.
 * @param options.putError The `{error}` message to answer a refusal with.
 * @param log Collects the saved bodies.
 */
function fakeFetch(
  options: {putStatus?: number; putError?: string} = {},
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
    return jsonResponse([GENERAL, STUDENT]);
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
    params: {id: TOURNAMENT_ID},
    fetch: fetchImpl,
    url: new URL(
      `http://localhost/admin/tournaments/${TOURNAMENT_ID}/regulations`,
    ),
  } as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` the save action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    params: {id: TOURNAMENT_ID},
    fetch: fetchImpl,
    url: new URL(
      `http://localhost/admin/tournaments/${TOURNAMENT_ID}/regulations`,
    ),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
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

    await expect(actions.default(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations.map(r => r.label)).toEqual([
      '学生の部',
      '一般の部',
    ]);
  });

  it('keeps the rendered order when nobody renumbered anything', async () => {
    const log: FetchLog = {putBodies: []};
    const formData = new FormData();
    // Set out of order on purpose: the index decides, not the body order.
    setRow(formData, 1, {id: STUDENT.id, label: '学生の部'});
    setRow(formData, 0, {id: GENERAL.id, label: '一般の部'});
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).resolves.toMatchObject({saved: true});
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

    await expect(actions.default(event)).resolves.toMatchObject({saved: true});
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

    await expect(actions.default(event)).resolves.toMatchObject({saved: true});
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

    await expect(actions.default(event)).resolves.toMatchObject({saved: true});
    expect(log.putBodies[0].regulations[0]).toMatchObject({
      priorityStartsAt: '2026-04-01T00:00:00.000Z',
      priorityEndsAt: '2026-04-30T00:00:00.000Z',
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

    await expect(actions.default(event)).resolves.toMatchObject({
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

    await expect(actions.default(event)).resolves.toMatchObject({
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

    await expect(actions.default(event)).resolves.toMatchObject({
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

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 409,
      data: {saved: false, error: message},
    });
  });

  it('echoes the submitted rows back so a refused save re-renders them', async () => {
    const formData = new FormData();
    setRow(formData, 0, {id: GENERAL.id, label: '書き換えた名前'});
    const event = buildActionEvent(fakeFetch({putStatus: 409}), formData);

    await expect(actions.default(event)).resolves.toMatchObject({
      data: {rows: [expect.objectContaining({label: '書き換えた名前'})]},
    });
  });
});
