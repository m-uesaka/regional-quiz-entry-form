import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError, Redirect} from '@sveltejs/kit';
import {
  CUSTOM_FIELD_VALUE_MAX_LENGTH,
  ENTRY_FREE_TEXT_MAX_LENGTH,
  ENTRY_NAME_MAX_LENGTH,
  type MypageEntryDetail,
} from '@regional-quiz/shared';
import {
  fakePlatform,
  TOKYO_SAIKYOI_LIST_KEY,
} from '../../../../../test-support/fake-platform';
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
  regulationLabels: ['一般の部'],
  freeText: '自由記述',
  customFieldValues: {t_shirt_size: 'M'},
  status: 'confirmed',
  waitlistPosition: null,
  tournament: {
    name: 'テスト大会',
    type: 'saikyoi',
    regionId: '00000000-0000-0000-0000-000000000003',
    regionSlug: 'tokyo',
    ...OPEN_PERIOD,
  },
  formFieldDefs: [
    {
      fieldKey: 't_shirt_size',
      label: 'Tシャツサイズ',
      plainLabel: 'Tシャツサイズ',
      fieldType: 'radio',
      required: true,
      options: ['S', 'M', 'L'],
      displayOrder: 0,
    },
    {
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      plainLabel: '規約に同意する',
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
    patchError?: string;
  } = {},
  log: FetchLog = {patchBodies: []},
): typeof fetch {
  return (async (input, init) => {
    if (init?.method === 'PATCH') {
      log.patchBodies.push(JSON.parse(String(init.body)));
      const body =
        options.patchError === undefined
          ? {ok: true}
          : {error: options.patchError};
      return new Response(JSON.stringify(body), {
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

/**
 * Builds a stand-in for `event.cookies` that records the names deleted on
 * it, which is how a refused session is cleared.
 * @param deleted The array every `delete()` call appends its name to.
 */
function fakeCookies(deleted: string[]): Cookies {
  return {
    delete: (name: string) => deleted.push(name),
  } as unknown as Cookies;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(
  fetchImpl: typeof fetch,
  deleted: string[] = [],
): Parameters<typeof load>[0] {
  return {
    params: {entryId: ENTRY.id},
    fetch: fetchImpl,
    cookies: fakeCookies(deleted),
    url: new URL(`http://localhost/mypage/entries/${ENTRY.id}/edit`),
  } as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` the form action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
  deleted: string[] = [],
  platform?: App.Platform,
): Parameters<typeof actions.default>[0] {
  return {
    params: {entryId: ENTRY.id},
    fetch: fetchImpl,
    platform,
    cookies: fakeCookies(deleted),
    url: new URL(`http://localhost/mypage/entries/${ENTRY.id}/edit`),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

function validFormData(): FormData {
  const formData = new FormData();
  formData.set('name', '山田花子');
  formData.set('furigana', 'ヤマダハナコ');
  formData.set('displayName', '花子');
  formData.set('freeText', '更新後の自由記述');
  formData.set('custom.t_shirt_size', 'L');
  formData.set('custom.agree_to_rules', 'on');
  return formData;
}

describe('mypage entry edit +page.server load', () => {
  it('returns the entry when the entry period is open', async () => {
    const event = buildLoadEvent(fakeFetch());

    await expect(load(event)).resolves.toEqual({entry: ENTRY});
  });

  it('redirects to the login page when not logged in', async () => {
    const deleted: string[] = [];
    const event = buildLoadEvent(fakeFetch({detailStatus: 401}), deleted);

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual(['participant_session']);
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

  it('records an unchecked optional boolean checkbox as an empty list', async () => {
    const log: FetchLog = {patchBodies: []};
    // Optional here, because a *required* one left unchecked is refused by
    // the action itself — see the test below.
    const entry: MypageEntryDetail = {
      ...ENTRY,
      formFieldDefs: ENTRY.formFieldDefs.map(fieldDef =>
        fieldDef.fieldKey === 'agree_to_rules'
          ? {...fieldDef, required: false}
          : fieldDef,
      ),
    };
    const formData = validFormData();
    formData.delete('custom.agree_to_rules');
    const event = buildActionEvent(fakeFetch({entry}, log), formData);

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(log.patchBodies[0]).toMatchObject({
      customFieldValues: {t_shirt_size: 'L', agree_to_rules: []},
    });
  });

  it('refuses a required custom field left blank, naming the control', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    formData.delete('custom.agree_to_rules');
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        fieldErrors: {
          'custom.agree_to_rules': ['「規約に同意する」は必須です'],
        },
      },
    });
    // Refused here, so the API is never asked to store it.
    expect(log.patchBodies).toEqual([]);
  });

  it('names a field over its length limit, without calling the API', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    formData.set('displayName', 'あ'.repeat(ENTRY_NAME_MAX_LENGTH + 1));
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        fieldErrors: {
          displayName: [
            `エントリーリスト掲載名は${ENTRY_NAME_MAX_LENGTH}文字以内で入力してください`,
          ],
        },
      },
    });
    expect(log.patchBodies).toEqual([]);
  });

  it('names every required custom field left blank in one answer', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    formData.delete('custom.t_shirt_size');
    formData.delete('custom.agree_to_rules');
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        fieldErrors: {
          'custom.t_shirt_size': ['「Tシャツサイズ」は必須です'],
          'custom.agree_to_rules': ['「規約に同意する」は必須です'],
        },
      },
    });
    expect(log.patchBodies).toEqual([]);
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

  it('redirects to the login page when the session died before the read', async () => {
    const deleted: string[] = [];
    const event = buildActionEvent(
      fakeFetch({detailStatus: 401}),
      validFormData(),
      deleted,
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual(['participant_session']);
  });

  it('redirects to the login page when the session died before the save', async () => {
    const deleted: string[] = [];
    const event = buildActionEvent(
      fakeFetch({patchStatus: 401}),
      validFormData(),
      deleted,
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual(['participant_session']);
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

  it.each([
    ['entry period closed', 'エントリー期間外のため編集できません'],
    ['entry is cancelled', 'キャンセル済みのエントリーは編集できません'],
  ])('tells a 403 %s apart', async (code, message) => {
    const event = buildActionEvent(
      fakeFetch({patchStatus: 403, patchError: code}),
      validFormData(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 403,
      data: {error: message},
    });
  });

  it('claims neither reason for a 403 that names neither', async () => {
    const event = buildActionEvent(
      fakeFetch({patchStatus: 403, patchError: 'forbidden'}),
      validFormData(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 403,
      data: {
        error: 'エントリー期間外またはキャンセル済みのため編集できません',
      },
    });
  });

  it('fails with 404 when the entry has gone', async () => {
    const event = buildActionEvent(
      fakeFetch({patchStatus: 404, patchError: 'entry not found'}),
      validFormData(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 404,
      data: {error: 'エントリーが見つかりません'},
    });
  });

  it('answers a failure on our side as a 502', async () => {
    const event = buildActionEvent(
      fakeFetch({patchStatus: 500, patchError: 'internal error'}),
      validFormData(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 502,
      data: {error: 'エントリーの更新に失敗しました'},
    });
  });

  it('ignores form values for fields the tournament does not define', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    formData.set('custom.not_a_real_field', 'injected');
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

  // A browser submits a textarea's line breaks as CRLF but counts each as
  // one character against `maxlength`, so an answer it let through at the
  // limit must not come out over it here.
  it('counts a submitted CRLF as one character and stores it as \\n', async () => {
    const log: FetchLog = {patchBodies: []};
    const formData = validFormData();
    const line = 'あ'.repeat(9);
    // 200 lines of 9 characters and a line break: 2000 as the browser
    // counts it, 2199 as submitted.
    const freeText = `${line}\n`.repeat(200).slice(0, -1);
    expect(freeText.length).toBeLessThanOrEqual(ENTRY_FREE_TEXT_MAX_LENGTH);
    formData.set('freeText', freeText.replaceAll('\n', '\r\n'));
    const event = buildActionEvent(fakeFetch({}, log), formData);

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
    } satisfies Partial<Redirect>);
    expect(log.patchBodies).toMatchObject([{freeText}]);
  });

  it('names a custom answer over its limit once, under its own control', async () => {
    const log: FetchLog = {patchBodies: []};
    const entry: MypageEntryDetail = {
      ...ENTRY,
      formFieldDefs: [
        {
          fieldKey: 'message',
          label: 'メッセージ',
          plainLabel: 'メッセージ',
          fieldType: 'textarea',
          required: false,
          options: null,
          displayOrder: 0,
        },
      ],
    };
    const formData = validFormData();
    formData.set(
      'custom.message',
      'あ'.repeat(CUSTOM_FIELD_VALUE_MAX_LENGTH + 1),
    );
    const event = buildActionEvent(fakeFetch({entry}, log), formData);

    const result = await actions.default(event);

    expect(result).toMatchObject({
      status: 400,
      data: {
        fieldErrors: {
          'custom.message': [
            `「メッセージ」は${CUSTOM_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`,
          ],
        },
      },
    });
    expect(
      (result as {data: {fieldErrors: Record<string, unknown>}}).data
        .fieldErrors.customFieldValues,
    ).toBeUndefined();
    expect(log.patchBodies).toEqual([]);
  });

  describe('the cached public entry list (#125)', () => {
    it('drops it once the edit is saved', async () => {
      const {platform, stored} = fakePlatform();
      stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json([]));
      const event = buildActionEvent(
        fakeFetch(),
        validFormData(),
        [],
        platform,
      );

      await expect(actions.default(event)).rejects.toMatchObject({
        status: 303,
      });
      expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(false);
    });

    it('keeps it when the backend refuses the edit', async () => {
      const {platform, stored} = fakePlatform();
      stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json([]));
      const event = buildActionEvent(
        fakeFetch({patchStatus: 403}),
        validFormData(),
        [],
        platform,
      );

      await expect(actions.default(event)).resolves.toMatchObject({
        status: 403,
      });
      expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(true);
    });
  });
});
