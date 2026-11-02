import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import {fakeCookieJar} from '../../test-support/fake-cookies';
import {fakeFetch} from '../../test-support/fake-fetch';
import {jsonResponse} from '../../test-support/json-response';
import {actions, load} from './+page.server';

const TOKEN = 'b3f1c0de';
const RESET_URL = `http://localhost/password-reset?token=${TOKEN}`;
const REQUEST_URL = 'http://localhost/password-reset';
const TOKEN_COOKIE = 'password_reset_token';

interface FetchLog {
  urls: string[];
  bodies: unknown[];
  turnstileTokens: Array<string | null>;
}

function emptyLog(): FetchLog {
  return {urls: [], bodies: [], turnstileTokens: []};
}

/** Builds a fake `fetch` answering the reset POST with the given status. */
function fakeApi(status = 200, log: FetchLog = emptyLog()): typeof fetch {
  return fakeFetch([
    {
      respond: ({url, body, headers}) => {
        log.urls.push(url);
        log.bodies.push(body);
        log.turnstileTokens.push(headers.get('cf-turnstile-response'));
        return status === 200
          ? jsonResponse({ok: true})
          : jsonResponse({}, status);
      },
    },
  ]);
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(
  url: string,
  cookies: Cookies = fakeCookieJar().cookies,
): Parameters<typeof load>[0] {
  return {url: new URL(url), cookies} as Parameters<typeof load>[0];
}

/**
 * Builds the partial `RequestEvent` the form action needs. `RESET_URL`
 * stands for "the page was opened from the mailed link": the action then
 * finds `TOKEN` in the cookie `load` moved it into, and posts to the bare
 * URL.
 */
function buildActionEvent(
  url: string,
  fetchImpl: typeof fetch,
  formData: FormData,
  deleted: string[] = [],
): Parameters<typeof actions.default>[0] {
  const initial: Record<string, string> =
    url === RESET_URL ? {[TOKEN_COOKIE]: TOKEN} : {};
  return {
    url: new URL(url === RESET_URL ? REQUEST_URL : url),
    fetch: fetchImpl,
    cookies: fakeCookieJar(initial, deleted).cookies,
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
  // The token is moved out of the URL into an httpOnly cookie on arrival, so
  // it stays out of the history, a later `Referer` and the page (#120).
  it('moves a mailed token into a cookie and redirects to the bare URL', () => {
    const {cookies, jar, setOptions} = fakeCookieJar();

    expect(() => load(buildLoadEvent(RESET_URL, cookies))).toThrow(
      expect.objectContaining({
        status: 303,
        location: '/password-reset',
      }) as Error,
    );
    expect(jar.get(TOKEN_COOKIE)).toBe(TOKEN);
    expect(setOptions.get(TOKEN_COOKIE)).toMatchObject({
      path: '/password-reset',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 3600,
    });
  });

  // A reload, or a tab the browser restores, comes back without the query:
  // the link is still good, so the form must still be there.
  it('asks for a new password while the cookie holds a token', () => {
    const {cookies} = fakeCookieJar({[TOKEN_COOKIE]: TOKEN});

    expect(load(buildLoadEvent(REQUEST_URL, cookies))).toEqual({
      hasToken: true,
    });
  });

  it('asks for an email address when there is no token', () => {
    expect(load(buildLoadEvent(REQUEST_URL))).toEqual({hasToken: false});
  });

  it('treats an empty token as no token at all', () => {
    const {cookies, jar} = fakeCookieJar();

    expect(() =>
      load(buildLoadEvent(`${REQUEST_URL}?token=`, cookies)),
    ).toThrow(expect.objectContaining({status: 303}) as Error);
    expect(jar.has(TOKEN_COOKIE)).toBe(false);
  });
});

describe('password reset +page.server action, without a token', () => {
  it('asks the API to mail a reset link', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(REQUEST_URL, fakeApi(200, log), emailForm());

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
      fakeApi(400, log),
      emailForm('sanka@example.com', null),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.turnstileTokens).toEqual(['']);
  });

  it('drops a token that could not travel in a header', async () => {
    // A direct POST to this action, rather than anything the widget wrote:
    // forwarded as it stands, `new Request()` throws on the newline and the
    // caller gets a 500 error page instead of the challenge's 400.
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      REQUEST_URL,
      fakeApi(400, log),
      emailForm('sanka@example.com', 'token\r\nX-Injected: 1'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.turnstileTokens).toEqual(['']);
  });

  it('reports a refused Turnstile token as something to retry', async () => {
    const event = buildActionEvent(REQUEST_URL, fakeApi(400), emailForm());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          '「私はロボットではありません」の確認に失敗しました。ページを再読み込みして、もう一度お試しください',
      },
    });
  });

  it('asks the participant to wait when the API rate limits the request', async () => {
    const event = buildActionEvent(REQUEST_URL, fakeApi(429), emailForm());

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
      fakeApi(200, log),
      emailForm('not-an-email'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.urls).toEqual([]);
  });

  it('is what an empty token falls back to', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      `${REQUEST_URL}?token=`,
      fakeApi(200, log),
      emailForm(),
    );

    await expect(actions.default(event)).resolves.toEqual({sent: true});
    expect(log.urls[0]).toContain(
      '/api/auth/participant/password-reset/request',
    );
  });

  it('fails with 502 when the request cannot be sent', async () => {
    const event = buildActionEvent(REQUEST_URL, fakeApi(500), emailForm());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});

describe('password reset +page.server action, with a token', () => {
  it('confirms the reset and sends the participant back to the login page', async () => {
    const log: FetchLog = emptyLog();
    const deleted: string[] = [];
    const event = buildActionEvent(
      RESET_URL,
      fakeApi(200, log),
      passwordForm(),
      deleted,
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login?reset=done',
    } satisfies Partial<Redirect>);
    // The reset cut this browser's own session too, so the cookie has to go
    // or the login page would bounce the participant on to `/mypage`. The
    // spent token goes with it.
    expect(deleted).toEqual(['participant_session', TOKEN_COOKIE]);
    expect(log.urls[0]).toContain(
      '/api/auth/participant/password-reset/confirm',
    );
    expect(log.bodies).toEqual([{token: TOKEN, newPassword: 'newpassword1'}]);
  });

  it('fails with 400 without calling the API when the two passwords differ', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      RESET_URL,
      fakeApi(200, log),
      passwordForm('newpassword1', 'newpassword2'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'パスワードが一致しません'},
    });
    expect(log.urls).toEqual([]);
  });

  it('names the rule a too-common password broke, without calling the API', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      RESET_URL,
      fakeApi(200, log),
      passwordForm('qwertyuiop'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          'よく使われているパスワードのため使用できません。別のパスワードを入力してください',
      },
    });
    expect(log.urls).toEqual([]);
  });

  it('fails with 400 without calling the API when the password is too short', async () => {
    const log: FetchLog = emptyLog();
    const event = buildActionEvent(
      RESET_URL,
      fakeApi(200, log),
      passwordForm('short'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.urls).toEqual([]);
  });

  it('tells the participant to start over and drops the token when the link is no longer usable', async () => {
    const deleted: string[] = [];
    const event = buildActionEvent(
      RESET_URL,
      fakeApi(400),
      passwordForm(),
      deleted,
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定をやり直してください',
        tokenRejected: true,
      },
    });
    // So the page offers the "mail me a link" form again.
    expect(deleted).toEqual([TOKEN_COOKIE]);
  });

  it('fails with 502 when the reset request fails', async () => {
    const event = buildActionEvent(RESET_URL, fakeApi(500), passwordForm());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});
