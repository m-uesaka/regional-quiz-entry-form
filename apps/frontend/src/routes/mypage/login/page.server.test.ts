import {describe, expect, it} from 'vitest';
import type {Redirect} from '@sveltejs/kit';
import type {ParticipantClaims} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

const CLAIMS: ParticipantClaims = {
  sub: '00000000-0000-0000-0000-000000000001',
  pwdChangedAt: 0,
};

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(
  options: {participant?: ParticipantClaims | null; url?: string} = {},
): Parameters<typeof load>[0] {
  return {
    locals: {participant: options.participant ?? null},
    url: new URL(options.url ?? 'http://localhost/mypage/login'),
  } as Parameters<typeof load>[0];
}

/** Builds a fake `fetch` answering the login POST with the given status. */
function fakeLoginFetch(
  status: number,
  log: {bodies: unknown[]} = {bodies: []},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    log.bodies.push(JSON.parse(String(init?.body)));
    return new Response(status === 200 ? JSON.stringify({ok: true}) : '{}', {
      status,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

/** Builds the partial `RequestEvent` the login action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    fetch: fetchImpl,
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

function credentials(
  email = 'sanka@example.com',
  password = 'password1',
): FormData {
  const formData = new FormData();
  formData.set('email', email);
  formData.set('password', password);
  return formData;
}

describe('participant login +page.server load', () => {
  it('renders the form for a visitor without a session', () => {
    expect(load(buildLoadEvent())).toEqual({passwordReset: false});
  });

  it('reports a password reset that has just completed', () => {
    const event = buildLoadEvent({
      url: 'http://localhost/mypage/login?reset=done',
    });

    expect(load(event)).toEqual({passwordReset: true});
  });

  it('redirects an already logged-in participant to mypage', () => {
    expect(() => load(buildLoadEvent({participant: CLAIMS}))).toThrow(
      expect.objectContaining({
        status: 303,
        location: '/mypage',
      } satisfies Partial<Redirect>),
    );
  });
});

describe('participant login +page.server action', () => {
  it('posts the credentials and redirects to mypage', async () => {
    const log = {bodies: [] as unknown[]};
    const event = buildActionEvent(fakeLoginFetch(200, log), credentials());

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage',
    } satisfies Partial<Redirect>);
    expect(log.bodies).toEqual([
      {email: 'sanka@example.com', password: 'password1'},
    ]);
  });

  it('fails with 400 without calling the API when the email is malformed', async () => {
    const log = {bodies: [] as unknown[]};
    const event = buildActionEvent(
      fakeLoginFetch(200, log),
      credentials('not-an-email'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {email: 'not-an-email'},
    });
    expect(log.bodies).toEqual([]);
  });

  it('reports a rejected login without saying which half was wrong', async () => {
    const event = buildActionEvent(fakeLoginFetch(401), credentials());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 401,
      data: {
        error: 'メールアドレスまたはパスワードが違います',
        email: 'sanka@example.com',
      },
    });
  });

  it('asks the participant to wait when the API rate limits the login', async () => {
    // 429 rather than 401: the credentials were never even checked, so
    // "wrong password" would be both wrong and unhelpful.
    const event = buildActionEvent(fakeLoginFetch(429), credentials());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 429,
      data: {
        error:
          'ログインの試行が集中しています。しばらく待ってから再度お試しください',
        email: 'sanka@example.com',
      },
    });
  });

  it('never echoes the password back to the form', async () => {
    const event = buildActionEvent(fakeLoginFetch(401), credentials());

    const result = await actions.default(event);

    expect(JSON.stringify(result)).not.toContain('password1');
  });

  it('fails with 502 when the login request fails', async () => {
    const event = buildActionEvent(fakeLoginFetch(500), credentials());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});
