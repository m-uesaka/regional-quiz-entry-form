import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {MypageEntryDetail} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

const OPEN_PERIOD = {
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
};

const ENTRY: MypageEntryDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  tournamentId: '00000000-0000-0000-0000-000000000002',
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  regulationLabel: '一般の部',
  freeText: '自由記述',
  customFieldValues: {t_shirt_size: 'M'},
  status: 'confirmed',
  waitlistPosition: null,
  tournament: {
    name: 'テスト大会',
    type: 'saikyoi',
    regionId: '00000000-0000-0000-0000-000000000003',
    ...OPEN_PERIOD,
  },
  formFieldDefs: [
    {
      fieldKey: 't_shirt_size',
      label: 'Tシャツサイズ',
      fieldType: 'radio',
      required: true,
      options: ['S', 'M', 'L'],
      displayOrder: 0,
    },
    {
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'checkbox',
      required: true,
      options: null,
      displayOrder: 1,
    },
  ],
};

/** Records the PATCH bodies a fake `fetch` receives. */
interface FetchLog {
  patchBodies: unknown[];
}

/**
 * Builds a fake `fetch` answering the entry-detail GET and the PATCH the
 * action makes, so a test can assert on the body actually sent.
 */
function fakeFetch(
  options: {
    entry?: MypageEntryDetail;
    detailStatus?: number;
    patchStatus?: number;
  } = {},
  log: FetchLog = {patchBodies: []},
): typeof fetch {
  return (async (input, init) => {
    if (init?.method === 'PATCH') {
      log.patchBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ok: true}), {
        status: options.patchStatus ?? 200,
        headers: {'Content-Type': 'application/json'},
      });
    }
    return new Response(JSON.stringify(options.entry ?? ENTRY), {
      status: options.detailStatus ?? 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    params: {entryId: ENTRY.id},
    fetch: fetchImpl,
  } as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` the form action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    params: {entryId: ENTRY.id},
    fetch: fetchImpl,
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

function validFormData(): FormData {
  const formData = new FormData();
  formData.set('name', '山田花子');
  formData.set('furigana', 'ヤマダハナコ');
  formData.set('displayName', '花子');
  formData.set('freeText', '更新後の自由記述');
  formData.set('t_shirt_size', 'L');
  formData.set('agree_to_rules', 'on');
  return formData;
}

describe('mypage entry edit +page.server load', () => {
  it('returns the entry when the entry period is open', async () => {
    const event = buildLoadEvent(fakeFetch());

    await expect(load(event)).resolves.toEqual({entry: ENTRY});
  });

  it('throws 401 when not logged in', async () => {
    const event = buildLoadEvent(fakeFetch({detailStatus: 401}));

    await expect(load(event)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<HttpError>);
  });

  it("throws 404 when the entry is not the participant's own", async () => {
    const event = buildLoadEvent(fakeFetch({detailStatus: 404}));

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 outside the entry period', async () => {
    const closed: MypageEntryDetail = {
      ...ENTRY,
      tournament: {
        ...ENTRY.tournament,
        entryOpensAt: '2020-01-01T00:00:00.000Z',
        entryClosesAt: '2020-01-02T00:00:00.000Z',
      },
    };
    const event = buildLoadEvent(fakeFetch({entry: closed}));

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 for a cancelled entry even within the entry period', async () => {
    const cancelled: MypageEntryDetail = {...ENTRY, status: 'cancelled'};
    const event = buildLoadEvent(fakeFetch({entry: cancelled}));

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });
});

describe('mypage entry edit form action', () => {
  it('sends the edited fields and redirects to mypage', async () => {
    const log: FetchLog = {patchBodies: []};
    const event = buildActionEvent(fakeFetch({}, log), validFormData());

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage',
    });
    expect(log.patchBodies).toEqual([
      {
        name: '山田花子',
        furigana: 'ヤマダハナコ',
        displayName: '花子',
        freeText: '更新後の自由記述',
        customFieldValues: {
          t_shirt_size: 'L',
          // A boolean checkbox submits `"on"`; the action normalizes it to
          // the stored `[fieldKey]` representation.
          agree_to_rules: ['agree_to_rules'],
        },
      },
    ]);
  });

  it('records an unchecked boolean checkbox as an empty list', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    formData.delete('agree_to_rules');
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(log.patchBodies[0]).toMatchObject({
      customFieldValues: {t_shirt_size: 'L', agree_to_rules: []},
    });
  });

  it('fails with 400 and keeps the submitted values when a required field is empty', async () => {
    const formData = validFormData();
    formData.set('displayName', '');
    const event = buildActionEvent(fakeFetch(), formData);

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        values: {
          name: '山田花子',
          displayName: '',
          freeText: '更新後の自由記述',
          customFieldValues: {
            t_shirt_size: 'L',
            agree_to_rules: ['agree_to_rules'],
          },
        },
      },
    });
  });

  it('fails with 400 when the backend rejects the custom field answers', async () => {
    const event = buildActionEvent(
      fakeFetch({patchStatus: 400}),
      validFormData(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
    });
  });

  it('fails with 403 when the backend refuses the update', async () => {
    const event = buildActionEvent(
      fakeFetch({patchStatus: 403}),
      validFormData(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 403,
    });
  });

  it('ignores form values for fields the tournament does not define', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    formData.set('not_a_real_field', 'injected');
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(log.patchBodies[0]).toMatchObject({
      customFieldValues: {
        t_shirt_size: 'L',
        agree_to_rules: ['agree_to_rules'],
      },
    });
    expect(
      Object.keys(
        (log.patchBodies[0] as {customFieldValues: Record<string, unknown>})
          .customFieldValues,
      ),
    ).toEqual(['t_shirt_size', 'agree_to_rules']);
  });
});
