import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {
  FormFieldDef,
  Regulation,
  StaffClaims,
  Tournament,
} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

// Well in the past relative to any plausible test run time, so this is
// reliably outside the entry period without needing to inject `now`.
const OUT_OF_PERIOD_TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2020-02-01T00:00:00.000Z',
};

const OPEN_TOURNAMENT: Tournament = {
  ...OUT_OF_PERIOD_TOURNAMENT,
  entryClosesAt: '2099-01-01T00:00:00.000Z',
};

const REGULATIONS: Regulation[] = [
  {
    id: '00000000-0000-0000-0000-0000000000a1',
    tournamentId: OPEN_TOURNAMENT.id,
    label: '一般の部',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 0,
  },
];

const FORM_FIELD_DEFS: FormFieldDef[] = [
  {
    fieldKey: 'agree_rules',
    label: '規約に同意する',
    fieldType: 'checkbox',
    required: true,
    options: null,
    displayOrder: 0,
  },
];

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000003',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

interface FakeApiOptions {
  tournament?: Tournament;
  /** When set, the tournament lookup answers with this status instead. */
  tournamentStatus?: number;
  /** The `POST .../entries` response, defaulting to a created entry. */
  entryResponse?: {status: number; body: unknown};
  /** The tournament's custom form field definitions. */
  formFieldDefs?: FormFieldDef[];
  /** Collects every requested URL, for asserting which endpoints ran. */
  requests?: string[];
}

/**
 * Builds a fake `fetch` that answers each of the endpoints the page talks
 * to by path, so a test only has to say which one should behave unusually.
 * @param options Overrides for the individual endpoints.
 */
function fakeApi(options: FakeApiOptions = {}): typeof fetch {
  const tournament = options.tournament ?? OPEN_TOURNAMENT;
  return (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : new URL(String(input)).pathname;
    options.requests?.push(url);
    if (url.includes('/regulations')) {
      return Response.json(REGULATIONS);
    }
    if (url.includes('/form-definitions/')) {
      return Response.json(options.formFieldDefs ?? FORM_FIELD_DEFS);
    }
    if (url.includes('/entries')) {
      const entry = options.entryResponse ?? {status: 201, body: {id: 'entry'}};
      return Response.json(entry.body, {status: entry.status});
    }
    return Response.json(tournament, {status: options.tournamentStatus ?? 200});
  }) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
  tournamentSlug?: string;
}): Parameters<typeof load>[0] {
  return {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: options.tournamentSlug ?? 'saikyoi',
    },
    fetch: options.fetch,
    locals: {staff: options.staff},
  } as Parameters<typeof load>[0];
}

describe('entry +page.server load', () => {
  it('throws 403 when outside the entry period and no staff session', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: OUT_OF_PERIOD_TOURNAMENT}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('succeeds outside the entry period when a staff session is present', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: OUT_OF_PERIOD_TOURNAMENT}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({
      tournament: OUT_OF_PERIOD_TOURNAMENT,
      regulations: REGULATIONS,
      formFieldDefs: FORM_FIELD_DEFS,
    });
  });

  it('returns the regulations and form field defs the form is built from', async () => {
    const event = buildEvent({fetch: fakeApi(), staff: null});

    await expect(load(event)).resolves.toEqual({
      tournament: OPEN_TOURNAMENT,
      regulations: REGULATIONS,
      formFieldDefs: FORM_FIELD_DEFS,
    });
  });

  it('throws 404 when the backend responds not-ok', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournamentStatus: 404}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeApi(),
      staff: null,
      tournamentSlug: 'nope',
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });
});

/** A submission that passes `EntryInputSchema`, before any overrides. */
function validFormData(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    email: 'taro@example.com',
    password: 'password123',
    passwordConfirm: 'password123',
    regulationId: REGULATIONS[0].id,
    freeText: '',
    'custom.agree_rules': 'on',
    ...overrides,
  };
}

/** Builds the partial `RequestEvent` the action needs, cast for test use. */
function buildActionEvent(options: {
  fetch: typeof fetch;
  fields: Record<string, string>;
}): Parameters<typeof actions.default>[0] {
  const body = new FormData();
  for (const [key, value] of Object.entries(options.fields)) {
    body.append(key, value);
  }
  return {
    params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
    fetch: options.fetch,
    request: new Request('http://localhost/tokyo/saikyoi/entry', {
      method: 'POST',
      body,
    }),
  } as Parameters<typeof actions.default>[0];
}

describe('entry +page.server default action', () => {
  it('reports the confirmation mail on success', async () => {
    const result = await actions.default(
      buildActionEvent({fetch: fakeApi(), fields: validFormData()}),
    );

    expect(result).toEqual({submitted: true, email: 'taro@example.com'});
  });

  it('rejects a mismatched password confirmation before calling the API', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          entryResponse: {status: 500, body: {error: 'must not be reached'}},
        }),
        fields: validFormData({passwordConfirm: 'different123'}),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {fieldErrors: {passwordConfirm: ['パスワードが一致しません']}},
    });
  });

  it('does not read the regulations while handling a submission', async () => {
    const requests: string[] = [];

    await actions.default(
      buildActionEvent({fetch: fakeApi({requests}), fields: validFormData()}),
    );

    expect(requests.some(url => url.includes('/regulations'))).toBe(false);
  });

  it('reports a per-field failure in Japanese', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi(),
        // Accepted by `<input type="email">` but not by the schema, so this
        // reaches the action rather than being caught in the browser.
        fields: validFormData({email: 'taro@localhost'}),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {fieldErrors: {email: ['メールアドレスの形式が正しくありません']}},
    });
  });

  it('echoes the submitted values back without the passwords', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi(),
        fields: validFormData({email: 'not-an-email'}),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        values: {
          name: '山田太郎',
          email: 'not-an-email',
          regulationId: REGULATIONS[0].id,
          customFieldValues: {agree_rules: ['agree_rules']},
        },
      },
    });
    expect(
      (result as {data: Record<string, unknown>}).data.values,
    ).not.toHaveProperty('password');
  });

  it.each([
    [409, 'already entered', 'この大会には既にエントリー済みです'],
    [
      409,
      'already registered in another region',
      'このメールアドレスは別の地域で登録済みです',
    ],
    [
      401,
      'invalid password',
      'このメールアドレスは登録済みです。登録時のパスワードを入力してください',
    ],
    [403, 'entry period closed', 'エントリー期間外です'],
    [
      403,
      'regulation not eligible in priority window',
      '現在は優先期間中のため、選択したレギュレーションではエントリーできません',
    ],
  ])(
    'maps a %i %s response to its own message',
    async (status, code, message) => {
      const result = await actions.default(
        buildActionEvent({
          fetch: fakeApi({entryResponse: {status, body: {error: code}}}),
          fields: validFormData(),
        }),
      );

      expect(result).toMatchObject({status, data: {error: message}});
    },
  );

  it("reads a custom field whose key collides with one of the form's own inputs", async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          formFieldDefs: [
            {
              fieldKey: 'password',
              label: '合言葉',
              fieldType: 'textarea',
              required: false,
              options: null,
              displayOrder: 0,
            },
          ],
        }),
        // The submission fails validation so the echoed-back `values` can
        // be inspected.
        fields: validFormData({
          email: 'not-an-email',
          'custom.password': 'ひらけごま',
        }),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {values: {customFieldValues: {password: 'ひらけごま'}}},
    });
  });

  it('falls back to a status-based message for an unknown error string', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          entryResponse: {status: 409, body: {error: 'duplicate key value'}},
        }),
        fields: validFormData(),
      }),
    );

    expect(result).toMatchObject({
      status: 409,
      data: {error: '既にエントリー済みです'},
    });
  });
});
