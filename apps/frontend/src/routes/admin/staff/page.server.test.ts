import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {Region, StaffAccount} from '@regional-quiz/shared';
import {fakeCookies} from '../../../test-support/fake-cookies';
import {
  fakeFetch,
  type FakeRoute,
  type RecordedRequest,
} from '../../../test-support/fake-fetch';
import {GENERAL_STAFF, staffLocals} from '../../../test-support/staff-locals';
import {actions, load} from './+page.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

const ACCOUNT: StaffAccount = {
  id: '00000000-0000-0000-0000-000000000011',
  email: 'tokyo-staff@example.com',
  role: 'regional',
  regionId: TOKYO.id,
  regionSlug: TOKYO.slug,
  regionName: TOKYO.name,
  tournamentType: 'saikyoi',
  passwordSet: false,
  disabledAt: null,
};

/**
 * Builds a fake `fetch` answering both the accounts and the regions API.
 * @param options.status The status to answer a POST with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.calls Collects the requests sent.
 */
function fakeApi(
  options: {status?: number; error?: string; calls?: RecordedRequest[]} = {},
): typeof fetch {
  const reads: FakeRoute[] = [
    {method: 'GET', url: '/regions', body: [TOKYO]},
    {method: 'GET', body: [ACCOUNT]},
  ];
  const status = options.status ?? 200;
  const writes: FakeRoute[] =
    status >= 400
      ? [{status, body: {error: options.error ?? 'nope'}}]
      : [
          {url: /\/accounts$/, status, body: ACCOUNT},
          {status, body: {ok: true}},
        ];
  return fakeFetch([...reads, ...writes], options.calls);
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL('http://localhost/admin/staff'),
  } as Parameters<typeof load>[0];
}

/** The general staff member the actions run as, unless a test says not. */
const CALLER_ID = '00000000-0000-0000-0000-0000000000ff';

/** Builds the partial `RequestEvent` any of the actions needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
  deletedCookies: string[] = [],
): Parameters<typeof actions.invite>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(deletedCookies),
    locals: staffLocals({...GENERAL_STAFF, sub: CALLER_ID}),
    url: new URL('http://localhost/admin/staff'),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.invite>[0];
}

function inviteFormData(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('email', 'new-staff@example.com');
  formData.set('role', 'regional');
  formData.set('regionId', TOKYO.id);
  formData.set('tournamentType', 'saikyoi');
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value);
  }
  return formData;
}

describe('admin staff +page.server load', () => {
  it('returns the accounts alongside the regions the invite form offers', async () => {
    await expect(load(buildLoadEvent(fakeApi()))).resolves.toEqual({
      accounts: [ACCOUNT],
      regions: [TOKYO],
    });
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = fakeFetch([{status: 500, body: {error: 'boom'}}]);

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});

describe('admin staff invite action', () => {
  it('sends a regional account with its scope', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({status: 201, calls}),
      inviteFormData(),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({
      intent: 'invite',
      saved: true,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/staff/accounts',
        body: {
          role: 'regional',
          email: 'new-staff@example.com',
          regionId: TOKYO.id,
          tournamentType: 'saikyoi',
        },
      },
    ]);
  });

  it('drops the scope controls for a general account', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({status: 201, calls}),
      inviteFormData({role: 'general'}),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({saved: true});
    expect(calls[0].body).toEqual({
      role: 'general',
      email: 'new-staff@example.com',
    });
  });

  it('reports an address already registered on the email field', async () => {
    const event = buildActionEvent(fakeApi({status: 409}), inviteFormData());

    await expect(actions.invite(event)).resolves.toMatchObject({
      status: 409,
      data: {
        intent: 'invite',
        // #166: the address may well have the other type's account, so
        // the message names the type that clashed.
        fieldErrors: {
          email: [
            'このメールアドレスの最強位のアカウントは既に登録されています',
          ],
        },
        values: {email: 'new-staff@example.com'},
      },
    });
  });

  it('names a general account as the one already registered', async () => {
    const event = buildActionEvent(
      fakeApi({status: 409}),
      inviteFormData({role: 'general'}),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({
      status: 409,
      data: {
        fieldErrors: {
          email: [
            'このメールアドレスの統括スタッフアカウントは既に登録されています',
          ],
        },
      },
    });
  });

  it('refuses a regional account with no region without asking the API', async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      inviteFormData({regionId: ''}),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({status: 400});
    expect(calls).toEqual([]);
  });

  // 400 is the API's answer for a `region_id` naming no region, so it is
  // attached to the control that has to change — but only for the role that
  // has that control. A `general` invite has no region select at all.
  it('attaches a refused region to its control for a regional invite', async () => {
    const event = buildActionEvent(
      fakeApi({status: 400, error: 'unknown region'}),
      inviteFormData(),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({
      status: 400,
      data: {fieldErrors: {regionId: ['地域が見つかりません']}},
    });
  });

  it('names no control when a general invite is refused', async () => {
    const event = buildActionEvent(
      fakeApi({status: 400, error: 'unknown region'}),
      inviteFormData({role: 'general'}),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({
      status: 400,
      data: {error: '入力内容を確認してください', fieldErrors: {}},
    });
  });

  // The account exists at this point, so sending them back to the invite
  // form would only earn them a 409; the message has to point at the
  // re-send button instead.
  it('says to use the re-send button when the invite mail could not go out', async () => {
    const event = buildActionEvent(
      fakeApi({
        status: 500,
        error: 'account created but the setup mail could not be sent',
      }),
      inviteFormData(),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({
      status: 500,
      data: {
        error: expect.stringContaining('再送'),
        // Cleared, because re-submitting it would now be a duplicate.
        values: {email: ''},
      },
    });
  });
});

describe('admin staff re-send action', () => {
  it('asks the API to mail the account its password link again', async () => {
    const calls: RecordedRequest[] = [];
    const formData = new FormData();
    formData.set('id', ACCOUNT.id);
    const event = buildActionEvent(fakeApi({calls}), formData);

    await expect(actions.resend(event)).resolves.toMatchObject({
      intent: 'resend',
      accountId: ACCOUNT.id,
      saved: true,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/staff/accounts/${ACCOUNT.id}/password-reset`,
        body: undefined,
      },
    ]);
  });

  it('attaches a failure to the row it came from', async () => {
    const formData = new FormData();
    formData.set('id', ACCOUNT.id);
    const event = buildActionEvent(fakeApi({status: 404}), formData);

    await expect(actions.resend(event)).resolves.toMatchObject({
      status: 404,
      data: {
        intent: 'resend',
        accountId: ACCOUNT.id,
        error: 'スタッフアカウントが見つかりません',
      },
    });
  });
});

describe('admin staff revoke action', () => {
  /** The body of a press of one row's 「セッションを無効化」. */
  function revokeFormData(accountId: string): FormData {
    const formData = new FormData();
    formData.set('id', accountId);
    return formData;
  }

  it("asks the API to end every session of the row's account", async () => {
    const calls: RecordedRequest[] = [];
    const deletedCookies: string[] = [];
    const event = buildActionEvent(
      fakeApi({calls}),
      revokeFormData(ACCOUNT.id),
      deletedCookies,
    );

    await expect(actions.revoke(event)).resolves.toMatchObject({
      intent: 'revoke',
      accountId: ACCOUNT.id,
      saved: true,
      error: null,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/staff/accounts/${ACCOUNT.id}/revoke-sessions`,
        body: undefined,
      },
    ]);
    // Someone else's sessions: the caller's own stays.
    expect(deletedCookies).toEqual([]);
  });

  it('sends a staff member who revoked their own sessions to the login form', async () => {
    // Their own session was cut along with the rest, so there is no page
    // left to show them; the dead cookie goes too, rather than passing for a
    // session on the way there.
    const deletedCookies: string[] = [];
    const event = buildActionEvent(
      fakeApi(),
      revokeFormData(CALLER_ID),
      deletedCookies,
    );

    await expect(actions.revoke(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fadmin%2Fstaff',
    } satisfies Partial<Redirect>);
    expect(deletedCookies).toEqual(['staff_session']);
  });

  it('sends a session the API refuses to the login form', async () => {
    const deletedCookies: string[] = [];
    const event = buildActionEvent(
      fakeApi({status: 401}),
      revokeFormData(ACCOUNT.id),
      deletedCookies,
    );

    await expect(actions.revoke(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fadmin%2Fstaff',
    } satisfies Partial<Redirect>);
    expect(deletedCookies).toEqual(['staff_session']);
  });

  it('attaches an unknown account to the row it came from', async () => {
    const event = buildActionEvent(
      fakeApi({status: 404}),
      revokeFormData(ACCOUNT.id),
    );

    await expect(actions.revoke(event)).resolves.toMatchObject({
      status: 404,
      data: {
        intent: 'revoke',
        accountId: ACCOUNT.id,
        saved: false,
        error: 'スタッフアカウントが見つかりません',
      },
    });
  });

  it('reports any other failure as one the revocation did not survive', async () => {
    const event = buildActionEvent(
      fakeApi({status: 500}),
      revokeFormData(ACCOUNT.id),
    );

    await expect(actions.revoke(event)).resolves.toMatchObject({
      status: 502,
      data: {
        intent: 'revoke',
        accountId: ACCOUNT.id,
        error: 'セッションを無効化できませんでした',
      },
    });
  });
});

describe('admin staff disable action', () => {
  function rowFormData(accountId: string): FormData {
    const formData = new FormData();
    formData.set('id', accountId);
    return formData;
  }

  it("asks the API to disable the row's account", async () => {
    const calls: RecordedRequest[] = [];
    const event = buildActionEvent(fakeApi({calls}), rowFormData(ACCOUNT.id));

    await expect(actions.disable(event)).resolves.toMatchObject({
      intent: 'disable',
      accountId: ACCOUNT.id,
      saved: true,
      error: null,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/staff/accounts/${ACCOUNT.id}/disable`,
        body: undefined,
      },
    ]);
  });

  it('explains a refusal to leave no general staff', async () => {
    const event = buildActionEvent(
      fakeApi({
        status: 409,
        error: 'cannot disable the last general staff account',
      }),
      rowFormData(ACCOUNT.id),
    );

    await expect(actions.disable(event)).resolves.toMatchObject({
      status: 409,
      data: {
        intent: 'disable',
        accountId: ACCOUNT.id,
        error:
          '有効な統括スタッフがいなくなるため、このアカウントは無効化できません',
      },
    });
  });

  it("explains a refusal to disable the caller's own account", async () => {
    const event = buildActionEvent(
      fakeApi({status: 409, error: 'cannot disable your own account'}),
      rowFormData(CALLER_ID),
    );

    await expect(actions.disable(event)).resolves.toMatchObject({
      status: 409,
      data: {error: '自分自身のアカウントは無効化できません'},
    });
  });

  it('reports any other failure beside the row', async () => {
    const event = buildActionEvent(
      fakeApi({status: 500}),
      rowFormData(ACCOUNT.id),
    );

    await expect(actions.disable(event)).resolves.toMatchObject({
      status: 502,
      data: {
        intent: 'disable',
        accountId: ACCOUNT.id,
        error: 'アカウントを無効化できませんでした',
      },
    });
  });
});

describe('admin staff enable action', () => {
  it("asks the API to enable the row's account", async () => {
    const calls: RecordedRequest[] = [];
    const formData = new FormData();
    formData.set('id', ACCOUNT.id);
    const event = buildActionEvent(fakeApi({calls}), formData);

    await expect(actions.enable(event)).resolves.toMatchObject({
      intent: 'enable',
      accountId: ACCOUNT.id,
      saved: true,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/staff/accounts/${ACCOUNT.id}/enable`,
        body: undefined,
      },
    ]);
  });

  it('attaches an unknown account to the row it came from', async () => {
    const formData = new FormData();
    formData.set('id', ACCOUNT.id);
    const event = buildActionEvent(fakeApi({status: 404}), formData);

    await expect(actions.enable(event)).resolves.toMatchObject({
      status: 404,
      data: {intent: 'enable', error: 'スタッフアカウントが見つかりません'},
    });
  });
});

describe('admin staff re-send action (disabled account)', () => {
  it('says to enable a disabled account first', async () => {
    const formData = new FormData();
    formData.set('id', ACCOUNT.id);
    const event = buildActionEvent(
      fakeApi({status: 409, error: 'staff account disabled'}),
      formData,
    );

    await expect(actions.resend(event)).resolves.toMatchObject({
      status: 409,
      data: {
        intent: 'resend',
        error:
          '無効化されたアカウントにはパスワード設定メールを送れません。先に有効化してください',
      },
    });
  });
});
