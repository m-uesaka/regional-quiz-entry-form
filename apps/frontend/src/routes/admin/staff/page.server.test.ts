import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Region, StaffAccount} from '@regional-quiz/shared';
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
};

/** One request an action put on the wire. */
interface ApiCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Builds a fake `fetch` answering both the accounts and the regions API.
 * @param options.status The status to answer a POST with.
 * @param options.error The `{error}` message to answer a refusal with.
 * @param options.calls Collects the recorded requests.
 */
function fakeFetch(
  options: {status?: number; error?: string; calls?: ApiCall[]} = {},
): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as unknown);
    options.calls?.push({method, url, body});
    if (method === 'GET') {
      return jsonResponse(url.includes('/regions') ? [TOKYO] : [ACCOUNT]);
    }
    const status = options.status ?? 200;
    if (status >= 400) {
      return jsonResponse({error: options.error ?? 'nope'}, status);
    }
    return jsonResponse(
      url.endsWith('/accounts') ? ACCOUNT : {ok: true},
      status,
    );
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
    fetch: fetchImpl,
    url: new URL('http://localhost/admin/staff'),
  } as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` either action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.invite>[0] {
  return {
    fetch: fetchImpl,
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
    await expect(load(buildLoadEvent(fakeFetch()))).resolves.toEqual({
      accounts: [ACCOUNT],
      regions: [TOKYO],
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

describe('admin staff invite action', () => {
  it('sends a regional account with its scope', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({status: 201, calls}),
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
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({status: 201, calls}),
      inviteFormData({role: 'general'}),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({saved: true});
    expect(calls[0].body).toEqual({
      role: 'general',
      email: 'new-staff@example.com',
    });
  });

  it('reports an address already registered on the email field', async () => {
    const event = buildActionEvent(fakeFetch({status: 409}), inviteFormData());

    await expect(actions.invite(event)).resolves.toMatchObject({
      status: 409,
      data: {
        intent: 'invite',
        fieldErrors: {email: ['このメールアドレスは既に登録されています']},
        values: {email: 'new-staff@example.com'},
      },
    });
  });

  it('refuses a regional account with no region without asking the API', async () => {
    const calls: ApiCall[] = [];
    const event = buildActionEvent(
      fakeFetch({calls}),
      inviteFormData({regionId: ''}),
    );

    await expect(actions.invite(event)).resolves.toMatchObject({status: 400});
    expect(calls).toEqual([]);
  });

  // The account exists at this point, so sending them back to the invite
  // form would only earn them a 409; the message has to point at the
  // re-send button instead.
  it('says to use the re-send button when the invite mail could not go out', async () => {
    const event = buildActionEvent(
      fakeFetch({
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
    const calls: ApiCall[] = [];
    const formData = new FormData();
    formData.set('id', ACCOUNT.id);
    const event = buildActionEvent(fakeFetch({calls}), formData);

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
    const event = buildActionEvent(fakeFetch({status: 404}), formData);

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
