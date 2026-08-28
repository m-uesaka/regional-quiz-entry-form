import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import {actions, load} from './+page.server';

const TOKEN = 'b3f1c0de';
const RESET_URL = `http://localhost/password-reset?token=${TOKEN}`;
const REQUEST_URL = 'http://localhost/password-reset';

interface FetchLog {
  urls: string[];
  bodies: unknown[];
  turnstileTokens: Array<string | null>;
}

function emptyLog(): FetchLog {
  return {urls: [], bodies: [], turnstileTokens: []};
}

/** Builds a fake `fetch` answering the reset POST with the given status. */
function fakeFetch(status = 200, log: FetchLog = emptyLog()): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    log.urls.push(String(input));
    log.bodies.push(JSON.parse(String(init?.body)));
    log.turnstileTokens.push(
      new Headers(init?.headers).get('cf-turnstile-response'),
    );
    return new Response(status === 200 ? JSON.stringify({ok: true}) : '{}', {
      status,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(url: string): Parameters<typeof load>[0] {
  return {url: new URL(url)} as Parameters<typeof load>[0];
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

/** Builds the partial `RequestEvent` the form action needs. */
function buildActionEvent(
  url: string,
  fetchImpl: typeof fetch,
  formData: FormData,
  deleted: string[] = [],
): Parameters<typeof actions.default>[0] {
  return {
    url: new URL(url),
    fetch: fetchImpl,
    cookies: fakeCookies(deleted),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

function emailForm(
  email = 'sanka@example.com',
  turnstileToken: string | null = 'a-turnstile-token',
): FormData {
  const formData = new FormData();
  formData.set('email', email);
  // The control the Turnstile widget writes its token into, which the action
  // forwards to the API as a header.
  if (turnstileToken !== null) {
    formData.set('cf-turnstile-response', turnstileToken);
  }
  return formData;
}

function passwordForm(
  newPassword = 'newpassword1',
  newPasswordConfirm = newPassword,
): FormData {
  const formData = new FormData();
  formData.set('newPassword', newPassword);
  formData.set('newPasswordConfirm', newPasswordConfirm);
  return formData;
}

describe('password reset +page.server load', () => {
  it('asks for a new password when the mailed link carries a token', () => {
    expect(load(buildLoadEvent(RESET_URL))).toEqual({hasToken: true});
  });

  it('asks for an email address when there is no token', () => {
    expect(load(buildLoadEvent(REQUEST_URL))).toEqual({hasToken: false});
  });

  it('treats an empty token as no token at all', () => {
    expect(load(buildLoadEvent(`${REQUEST_URL}?token=`))).toEqual({
      hasToken: false,
    });
  });
});

describe('password reset +page.server action, without a token', () => {
  it('asks the API to mail a reset link', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      REQUEST_URL,
      fakeFetch(200, log),
      emailForm(),
    );

    await expect(actions.default(event)).resolves.toEqual({sent: true});
    expect(log.urls[0]).toContain(
      '/api/auth/participant/password-reset/request',
    );
    expect(log.bodies).toEqual([{email: 'sanka@example.com'}]);
    expect(log.turnstileTokens).toEqual(['a-turnstile-token']);
  });

  it('sends an empty token when the widget produced none', async () => {
    // What a submission with the widget unsolved (or never loaded) looks
    // like. The API is what refuses it -- the page does not decide that on
    // its own, so a broken widget cannot be talked past from the client.
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      REQUEST_URL,
      fakeFetch(400, log),
      emailForm('sanka@example.com', null),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.turnstileTokens).toEqual(['']);
  });

  it('reports a refused Turnstile token as something to retry', async () => {
    const event = buildActionEvent(REQUEST_URL, fakeFetch(400), emailForm());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          '「私はロボットではありません」の確認に失敗しました。ページを再読み込みして、もう一度お試しください',
      },
    });
  });

  it('asks the participant to wait when the API rate limits the request', async () => {
    const event = buildActionEvent(REQUEST_URL, fakeFetch(429), emailForm());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 429,
      data: {
        error: '送信が集中しています。しばらく待ってから再度お試しください',
      },
    });
  });

  it('fails with 400 without calling the API when the email is malformed', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      REQUEST_URL,
      fakeFetch(200, log),
      emailForm('not-an-email'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.urls).toEqual([]);
  });

  it('is what an empty token falls back to', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      `${REQUEST_URL}?token=`,
      fakeFetch(200, log),
      emailForm(),
    );

    await expect(actions.default(event)).resolves.toEqual({sent: true});
    expect(log.urls[0]).toContain(
      '/api/auth/participant/password-reset/request',
    );
  });

  it('fails with 502 when the request cannot be sent', async () => {
    const event = buildActionEvent(REQUEST_URL, fakeFetch(500), emailForm());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});

describe('password reset +page.server action, with a token', () => {
  it('confirms the reset and sends the participant back to the login page', async () => {
    const log: FetchLog = emptyLog();
    const deleted: string[] = [];
    const event = buildActionEvent(
      RESET_URL,
      fakeFetch(200, log),
      passwordForm(),
      deleted,
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login?reset=done',
    } satisfies Partial<Redirect>);
    // The reset cut this browser's own session too, so the cookie has to go
    // or the login page would bounce the participant on to `/mypage`.
    expect(deleted).toEqual(['participant_session']);
    expect(log.urls[0]).toContain(
      '/api/auth/participant/password-reset/confirm',
    );
    expect(log.bodies).toEqual([{token: TOKEN, newPassword: 'newpassword1'}]);
  });

  it('fails with 400 without calling the API when the two passwords differ', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      RESET_URL,
      fakeFetch(200, log),
      passwordForm('newpassword1', 'newpassword2'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'パスワードが一致しません'},
    });
    expect(log.urls).toEqual([]);
  });

  it('fails with 400 without calling the API when the password is too short', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      RESET_URL,
      fakeFetch(200, log),
      passwordForm('short'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.urls).toEqual([]);
  });

  it('tells the participant to start over when the link is no longer usable', async () => {
    const event = buildActionEvent(RESET_URL, fakeFetch(400), passwordForm());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定をやり直してください',
      },
    });
  });

  it('fails with 502 when the reset request fails', async () => {
    const event = buildActionEvent(RESET_URL, fakeFetch(500), passwordForm());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});
