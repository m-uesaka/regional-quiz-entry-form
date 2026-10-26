import {describe, expect, it, vi} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {
  FormFieldDef,
  ParticipantClaims,
  Regulation,
  StaffClaims,
  Tournament,
} from '@regional-quiz/shared';
import {formatJstDateTime} from '$lib/jst-datetime';
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
    plainLabel: '規約に同意する',
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
  sessionsValidFrom: 1756085025678,
};

/** 地域スタッフ covering exactly the tournament under test. */
const OWN_REGIONAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000004',
  role: 'regional',
  regionId: OUT_OF_PERIOD_TOURNAMENT.regionId,
  tournamentType: OUT_OF_PERIOD_TOURNAMENT.type,
  sessionsValidFrom: 1756085025678,
};

const OTHER_REGION_STAFF: StaffClaims = {
  ...OWN_REGIONAL_STAFF,
  regionId: '00000000-0000-0000-0000-0000000000ff',
};

const OTHER_TYPE_STAFF: StaffClaims = {
  ...OWN_REGIONAL_STAFF,
  tournamentType: 'shinjinou',
  sessionsValidFrom: 1756085025678,
};

interface FakeApiOptions {
  tournament?: Tournament;
  /** When set, the tournament lookup answers with this status instead. */
  tournamentStatus?: number;
  /**
   * The `POST .../entries` (or `.../entries/session`) response, defaulting
   * to what each answers on success: 202 for an anonymous submission, 201
   * with the entry for a logged-in one.
   */
  entryResponse?: {status: number; body: unknown};
  /** The tournament's custom form field definitions. */
  formFieldDefs?: FormFieldDef[];
  /** The tournament's regulations. */
  regulations?: Regulation[];
  /**
   * The `GET .../entry-counts` response, defaulting to no entries; `'throw'`
   * makes the request itself fail, as a network error would.
   */
  entryCounts?: {status: number; body: unknown} | 'throw';
  /** Collects every requested URL, for asserting which endpoints ran. */
  requests?: string[];
  /**
   * Collects the `cf-turnstile-response` header of every entry submission,
   * which is how the widget's token reaches the API.
   */
  turnstileTokens?: Array<string | null>;
}

/**
 * Builds a fake `fetch` that answers each of the endpoints the page talks
 * to by path, so a test only has to say which one should behave unusually.
 * @param options Overrides for the individual endpoints.
 */
function fakeApi(options: FakeApiOptions = {}): typeof fetch {
  const tournament = options.tournament ?? OPEN_TOURNAMENT;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : new URL(String(input)).pathname;
    options.requests?.push(url);
    if (url.includes('/regulations')) {
      return Response.json(options.regulations ?? REGULATIONS);
    }
    if (url.includes('/entry-counts')) {
      if (options.entryCounts === 'throw') {
        throw new TypeError('fetch failed');
      }
      const counts = options.entryCounts ?? {
        status: 200,
        body: {confirmedCount: 0, waitlistedCount: 0},
      };
      return Response.json(counts.body, {status: counts.status});
    }
    if (url.includes('/form-definitions/')) {
      return Response.json(options.formFieldDefs ?? FORM_FIELD_DEFS);
    }
    if (url.includes('/entries')) {
      options.turnstileTokens?.push(
        new Headers(init?.headers).get('cf-turnstile-response'),
      );
      const entry =
        options.entryResponse ??
        (url.endsWith('/entries/session')
          ? {status: 201, body: {id: 'entry'}}
          : {status: 202, body: {ok: true}});
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
  deletedCookies?: string[];
}): Parameters<typeof load>[0] {
  return {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: options.tournamentSlug ?? 'saikyoi',
    },
    fetch: options.fetch,
    locals: {staff: options.staff, participant: null},
    url: new URL('http://localhost/tokyo/saikyoi/entry'),
    cookies: {
      delete: (name: string) => {
        options.deletedCookies?.push(name);
      },
    },
  } as unknown as Parameters<typeof load>[0];
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

  it('succeeds outside the entry period for 統括スタッフ', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: OUT_OF_PERIOD_TOURNAMENT}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toMatchObject({
      tournament: OUT_OF_PERIOD_TOURNAMENT,
      regulations: REGULATIONS,
      formFieldDefs: FORM_FIELD_DEFS,
    });
  });

  it("succeeds outside the entry period for the tournament's own 地域スタッフ", async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: OUT_OF_PERIOD_TOURNAMENT}),
      staff: OWN_REGIONAL_STAFF,
    });

    await expect(load(event)).resolves.toMatchObject({
      tournament: OUT_OF_PERIOD_TOURNAMENT,
    });
  });

  // Holding a staff session is not the same as covering this tournament:
  // the requirement grants the closed-period form to its own 地域スタッフ,
  // not to every regional account there is.
  it("throws 403 outside the entry period for another region's 地域スタッフ", async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: OUT_OF_PERIOD_TOURNAMENT}),
      staff: OTHER_REGION_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 outside the entry period for 地域スタッフ of the other tournament type', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: OUT_OF_PERIOD_TOURNAMENT}),
      staff: OTHER_TYPE_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  // The backend applies the same rule and refuses first, so the page never
  // sees the tournament at all in that case.
  it('throws 403 when the API refuses the tournament read as out of period', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournamentStatus: 403}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  // A stale or revoked staff cookie earns a 401 from that gate instead of
  // the 403 above. Only staff hold one, so it is dropped and its holder sent
  // to log in again, rather than told the period is closed while the dead
  // cookie stays put.
  it('drops a refused staff cookie and sends its holder to log in', async () => {
    const deletedCookies: string[] = [];
    const event = buildEvent({
      fetch: fakeApi({tournamentStatus: 401}),
      staff: null,
      deletedCookies,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: `/staff/login?redirectTo=${encodeURIComponent('/tokyo/saikyoi/entry')}`,
    });
    expect(deletedCookies).toEqual(['staff_session']);
  });

  it('returns the regulations and form field defs the form is built from', async () => {
    const event = buildEvent({fetch: fakeApi(), staff: null});

    await expect(load(event)).resolves.toEqual({
      tournament: OPEN_TOURNAMENT,
      regulations: REGULATIONS,
      formFieldDefs: FORM_FIELD_DEFS,
      priorityNotices: [],
      waitlistOpen: false,
      loggedIn: false,
      loginPath: '/mypage/login?redirectTo=%2Ftokyo%2Fsaikyoi%2Fentry',
    });
  });

  it('announces the 優先エントリー open now', async () => {
    const day = 24 * 60 * 60 * 1000;
    const endsAt = new Date(Date.now() + day);
    const event = buildEvent({
      fetch: fakeApi({
        regulations: [
          {
            ...REGULATIONS[0],
            priorityStartsAt: new Date(Date.now() - day).toISOString(),
            priorityEndsAt: endsAt.toISOString(),
          },
        ],
      }),
      staff: null,
    });

    const data = await load(event);

    expect(data?.priorityNotices).toEqual([
      {
        labels: [REGULATIONS[0].label],
        endsAtLabel: formatJstDateTime(endsAt.toISOString()),
      },
    ]);
  });

  // A staff preview of a closed form: a window can outlast its form, and
  // neither notice is about entries the form is taking any more.
  it('announces neither notice outside the entry period', async () => {
    const day = 24 * 60 * 60 * 1000;
    const event = buildEvent({
      fetch: fakeApi({
        tournament: {...OUT_OF_PERIOD_TOURNAMENT, capacity: 30},
        regulations: [
          {
            ...REGULATIONS[0],
            priorityStartsAt: new Date(Date.now() - day).toISOString(),
            priorityEndsAt: new Date(Date.now() + day).toISOString(),
          },
        ],
        entryCounts: {
          status: 200,
          body: {confirmedCount: 30, waitlistedCount: 0},
        },
      }),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toMatchObject({
      priorityNotices: [],
      waitlistOpen: false,
    });
  });

  it('says the waitlist is open once the capacity is reached', async () => {
    const event = buildEvent({
      fetch: fakeApi({
        tournament: {...OPEN_TOURNAMENT, capacity: 30},
        entryCounts: {
          status: 200,
          body: {confirmedCount: 30, waitlistedCount: 0},
        },
      }),
      staff: null,
    });

    await expect(load(event)).resolves.toMatchObject({waitlistOpen: true});
  });

  // The counts only feed the notice, so the form stays usable without them.
  it('leaves the waitlist notice out when the counts cannot be read', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const event = buildEvent({
      fetch: fakeApi({
        tournament: {...OPEN_TOURNAMENT, capacity: 30},
        entryCounts: {status: 500, body: {error: 'boom'}},
      }),
      staff: null,
    });

    await expect(load(event)).resolves.toMatchObject({waitlistOpen: false});
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('500'));
    consoleError.mockRestore();
  });

  it('keeps the form up when the counts request itself fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const event = buildEvent({
      fetch: fakeApi({
        tournament: {...OPEN_TOURNAMENT, capacity: 30},
        entryCounts: 'throw',
      }),
      staff: null,
    });

    await expect(load(event)).resolves.toMatchObject({waitlistOpen: false});
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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
  overrides: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  return {
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    email: 'taro@example.com',
    password: 'quiz-entry-pass1',
    passwordConfirm: 'quiz-entry-pass1',
    regulationIds: [REGULATIONS[0].id],
    freeText: '',
    'custom.agree_rules': 'on',
    // The control the Turnstile widget writes its token into.
    'cf-turnstile-response': 'a-turnstile-token',
    ...overrides,
  };
}

/** Builds the partial `RequestEvent` the action needs, cast for test use. */
function buildActionEvent(options: {
  fetch: typeof fetch;
  fields: Record<string, string | string[]>;
  participant?: ParticipantClaims | null;
  /** Collects the names of the cookies the action deletes. */
  deletedCookies?: string[];
}): Parameters<typeof actions.default>[0] {
  const body = new FormData();
  for (const [key, value] of Object.entries(options.fields)) {
    // A checked checkbox group submits its name once per box, which is
    // what the regulation selector produces.
    for (const entry of Array.isArray(value) ? value : [value]) {
      body.append(key, entry);
    }
  }
  return {
    params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
    fetch: options.fetch,
    request: new Request('http://localhost/tokyo/saikyoi/entry', {
      method: 'POST',
      body,
    }),
    locals: {staff: null, participant: options.participant ?? null},
    url: new URL('http://localhost/tokyo/saikyoi/entry'),
    cookies: {
      delete: (name: string) => {
        options.deletedCookies?.push(name);
      },
    },
  } as unknown as Parameters<typeof actions.default>[0];
}

const PARTICIPANT: ParticipantClaims = {
  sub: '00000000-0000-0000-0000-000000000005',
  pwdChangedAt: 0,
};

/** What a form rendered for a logged-in participant submits. */
function sessionFormData(
  overrides: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  const fields = validFormData({entryMode: 'session', ...overrides});
  delete fields.email;
  delete fields.password;
  delete fields.passwordConfirm;
  return fields;
}

describe('entry +page.server default action for a logged-in participant', () => {
  // Someone logged in in another tab after this anonymous form was opened.
  // The address and password typed into it must not be dropped in favour of
  // whoever that is.
  it('keeps a form rendered anonymously on the anonymous path even with a session', async () => {
    const requests: string[] = [];

    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({requests}),
        fields: validFormData(),
        participant: PARTICIPANT,
      }),
    );

    expect(result).toEqual({submitted: true, email: 'taro@example.com'});
    expect(requests).toContain(
      `/api/tournaments/${OPEN_TOURNAMENT.id}/entries`,
    );
    expect(requests.some(url => url.endsWith('/entries/session'))).toBe(false);
  });

  it('enters under the session without asking for credentials', async () => {
    const requests: string[] = [];

    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({requests}),
        fields: sessionFormData(),
        participant: PARTICIPANT,
      }),
    );

    expect(result).toEqual({submitted: true, loggedIn: true});
    expect(requests).toContain(
      `/api/tournaments/${OPEN_TOURNAMENT.id}/entries/session`,
    );
  });

  // The session already says who is asking, so the API refuses directly and
  // the form can say why.
  it('reports a refusal directly', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          entryResponse: {status: 409, body: {error: 'already entered'}},
        }),
        fields: sessionFormData(),
        participant: PARTICIPANT,
      }),
    );

    expect(result).toMatchObject({
      status: 409,
      data: {error: 'この大会には既にエントリー済みです'},
    });
  });

  it('sends a participant whose session lapsed while the form was open to log in', async () => {
    const requests: string[] = [];

    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({requests}),
        fields: sessionFormData(),
        participant: null,
      }),
    );

    expect(result).toMatchObject({
      status: 401,
      data: {
        loginPath: '/mypage/login?redirectTo=%2Ftokyo%2Fsaikyoi%2Fentry',
      },
    });
    expect(requests.some(url => url.includes('/entries'))).toBe(false);
  });

  // The cookie still reads as valid here, but the API cut it (a password
  // reset, a deleted participant). Left in place, `/mypage/login` would take
  // the visitor for logged in and send them straight back to this form.
  it('offers the login screen and drops the dead cookie when the API refuses the session', async () => {
    const deletedCookies: string[] = [];

    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          entryResponse: {status: 401, body: {error: 'unauthorized'}},
        }),
        fields: sessionFormData(),
        participant: PARTICIPANT,
        deletedCookies,
      }),
    );

    expect(deletedCookies).toEqual(['participant_session']);
    expect(result).toMatchObject({
      status: 401,
      data: {
        error:
          'ログインの有効期限が切れました。もう一度ログインしてからエントリーしてください',
        loginPath: '/mypage/login?redirectTo=%2Ftokyo%2Fsaikyoi%2Fentry',
      },
    });
  });
});

describe('entry +page.server default action', () => {
  it('reports the confirmation mail on success', async () => {
    const result = await actions.default(
      buildActionEvent({fetch: fakeApi(), fields: validFormData()}),
    );

    expect(result).toEqual({submitted: true, email: 'taro@example.com'});
  });

  // Answered before anything about the address is known (#117): the entry
  // may or may not exist, so the result names the address mailed and claims
  // nothing else.
  it('posts an anonymous submission to the address-blind endpoint', async () => {
    const requests: string[] = [];

    await actions.default(
      buildActionEvent({fetch: fakeApi({requests}), fields: validFormData()}),
    );

    expect(requests).toContain(
      `/api/tournaments/${OPEN_TOURNAMENT.id}/entries`,
    );
    expect(requests.some(url => url.endsWith('/entries/session'))).toBe(false);
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

  // The same field is how a returning participant proves an existing
  // password, which may predate the common-password rule, so the form lets
  // one through and the backend refuses it only for a new address -- by
  // mail, like every other answer that depends on the address (#117).
  it('passes a common password on to the API', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi(),
        fields: validFormData({
          password: 'Password123',
          passwordConfirm: 'Password123',
        }),
      }),
    );

    expect(result).toEqual({submitted: true, email: 'taro@example.com'});
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
          regulationIds: [REGULATIONS[0].id],
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
      'このアカウントは別の地域で登録済みのため、この大会にはエントリーできません',
    ],
    [403, 'entry period closed', 'エントリー期間外です'],
    [
      403,
      'regulation not eligible in priority window',
      '現在は優先期間中のため、優先対象のレギュレーションを1つ以上選択してください',
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
              plainLabel: '合言葉',
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

  it('refuses a required checkbox group left blank, naming the control', async () => {
    // The group carries no `required` until the client bundle has taken the
    // form over (#95), so this is the submission a visitor who beat
    // hydration — or has JS off — actually makes, and the action is what has
    // to answer it.
    const requests: string[] = [];
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          formFieldDefs: [
            {
              fieldKey: 'workshops',
              label: '参加したい企画',
              plainLabel: '参加したい企画',
              fieldType: 'checkbox',
              required: true,
              options: ['早押し', '筆記'],
              displayOrder: 0,
            },
          ],
          requests,
        }),
        fields: validFormData(),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        fieldErrors: {'custom.workshops': ['「参加したい企画」は必須です']},
      },
    });
    // Refused here, so the API is never asked to create the entry.
    expect(requests.some(url => url.includes('/entries'))).toBe(false);
  });

  it('reports every rejected field, custom and built-in, in one answer', async () => {
    // The participants this check exists for get no browser-side complaints
    // at all, and the two password fields are never echoed back, so a
    // one-at-a-time answer would make them retype both passwords once per
    // problem.
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          formFieldDefs: [
            {
              fieldKey: 'workshops',
              label: '参加したい企画',
              plainLabel: '参加したい企画',
              fieldType: 'checkbox',
              required: true,
              options: ['早押し', '筆記'],
              displayOrder: 0,
            },
            {
              fieldKey: 't_shirt_size',
              label: 'Tシャツサイズ',
              plainLabel: 'Tシャツサイズ',
              fieldType: 'radio',
              required: true,
              options: ['S', 'M'],
              displayOrder: 1,
            },
          ],
          entryResponse: {status: 500, body: {error: 'must not be reached'}},
        }),
        fields: validFormData({passwordConfirm: 'different123'}),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        fieldErrors: {
          'custom.workshops': ['「参加したい企画」は必須です'],
          'custom.t_shirt_size': ['「Tシャツサイズ」は必須です'],
          passwordConfirm: ['パスワードが一致しません'],
        },
      },
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

  it("forwards the widget's token to the API", async () => {
    const turnstileTokens: Array<string | null> = [];

    await actions.default(
      buildActionEvent({
        fetch: fakeApi({turnstileTokens}),
        fields: validFormData(),
      }),
    );

    expect(turnstileTokens).toEqual(['a-turnstile-token']);
  });

  it('sends an empty token when the widget produced none', async () => {
    // What a submission with the widget unsolved (or never loaded) looks
    // like. Refusing it is the API's job, not this page's, so nothing here
    // stops the call from being made.
    const turnstileTokens: Array<string | null> = [];

    await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          turnstileTokens,
          entryResponse: {
            status: 400,
            body: {error: 'turnstile verification failed'},
          },
        }),
        fields: validFormData({'cf-turnstile-response': ''}),
      }),
    );

    expect(turnstileTokens).toEqual(['']);
  });

  it('drops a token that could not travel in a header', async () => {
    // A direct POST to this action, rather than anything the widget wrote:
    // forwarded as it stands, `new Request()` throws on the newline and the
    // participant gets a 500 error page instead of the challenge's 400.
    const turnstileTokens: Array<string | null> = [];

    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          turnstileTokens,
          entryResponse: {
            status: 400,
            body: {error: 'turnstile verification failed'},
          },
        }),
        fields: validFormData({
          'cf-turnstile-response': 'token\r\nX-Injected: 1',
        }),
      }),
    );

    expect(result).toMatchObject({status: 400});
    expect(turnstileTokens).toEqual(['']);
  });

  it('reports a refused Turnstile token as something to retry', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          entryResponse: {
            status: 400,
            body: {error: 'turnstile verification failed'},
          },
        }),
        fields: validFormData(),
      }),
    );

    expect(result).toMatchObject({
      status: 400,
      data: {
        error:
          '「私はロボットではありません」の確認に失敗しました。ページを再読み込みして、もう一度お試しください',
      },
    });
  });

  it('asks the participant to wait when the API rate limits the submission', async () => {
    const result = await actions.default(
      buildActionEvent({
        fetch: fakeApi({
          entryResponse: {status: 429, body: {error: 'too many requests'}},
        }),
        fields: validFormData(),
      }),
    );

    expect(result).toMatchObject({
      status: 429,
      data: {
        error: '送信が集中しています。しばらく待ってから再度お試しください',
      },
    });
  });
});
