import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import {fakeCookieJar} from '../../../test-support/fake-cookies';
import {
  fakeFetch,
  type FakeRequest,
  type RecordedRequest,
} from '../../../test-support/fake-fetch';
import {actions, load} from './+page.server';

const TOKEN = 'c0ffee01';
const RESET_URL = `http://localhost/staff/password-reset?token=${TOKEN}`;
const NO_TOKEN_URL = 'http://localhost/staff/password-reset';
const TOKEN_COOKIE = 'staff_password_reset_token';

const REQUEST_PATH = '/api/auth/staff/password-reset/request';
const CONFIRM_PATH = '/api/auth/staff/password-reset/confirm';

/**
 * Builds a fake `fetch` answering either reset POST with the given status.
 * @param requests Collects the requests sent.
 * @param requestsWithHeaders Collects the requests sent, headers included.
 */
function fakeApi(
  status = 200,
  requests?: RecordedRequest[],
  requestsWithHeaders?: FakeRequest[],
): typeof fetch {
  const body = status === 200 ? {ok: true} : {};
  return fakeFetch(
    [
      {method: 'POST', url: REQUEST_PATH, status, body},
      {method: 'POST', url: CONFIRM_PATH, status, body},
    ],
    requests,
    requestsWithHeaders,
  );
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildLoadEvent(
  url: string,
  cookies: Cookies = fakeCookieJar().cookies,
): Parameters<typeof load>[0] {
  return {url: new URL(url), cookies} as Parameters<typeof load>[0];
}

/** Builds the partial `RequestEvent` the form action needs. */
function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
  cookies: Cookies = fakeCookieJar({[TOKEN_COOKIE]: TOKEN}).cookies,
): Parameters<typeof actions.default>[0] {
  return {
    url: new URL(NO_TOKEN_URL),
    fetch: fetchImpl,
    cookies,
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

function requestForm(email = 'staff@example.com', scope = 'saikyoi'): FormData {
  const formData = new FormData();
  formData.set('email', email);
  formData.set('scope', scope);
  formData.set('cf-turnstile-response', 'a-turnstile-token');
  return formData;
}

function passwordForm(
  newPassword = 'newstaffpassword1',
  newPasswordConfirm = newPassword,
): FormData {
  const formData = new FormData();
  formData.set('newPassword', newPassword);
  formData.set('newPasswordConfirm', newPasswordConfirm);
  return formData;
}

describe('staff password reset +page.server load', () => {
  // The token is moved out of the URL into an httpOnly cookie on arrival, so
  // it stays out of the history, a later `Referer` and the page (#120).
  it('moves a mailed token into a cookie and redirects to the bare URL', () => {
    const {cookies, jar, setOptions} = fakeCookieJar();

    expect(() => load(buildLoadEvent(RESET_URL, cookies))).toThrow(
      expect.objectContaining({
        status: 303,
        location: '/staff/password-reset',
      }) as Error,
    );
    expect(jar.get(TOKEN_COOKIE)).toBe(TOKEN);
    expect(setOptions.get(TOKEN_COOKIE)).toMatchObject({
      path: '/staff/password-reset',
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  // A reload, or a tab the browser restores, comes back without the query:
  // the link is still good, so the form must still be there.
  it('shows the password form while the cookie holds a token', () => {
    const {cookies} = fakeCookieJar({[TOKEN_COOKIE]: TOKEN});

    expect(load(buildLoadEvent(NO_TOKEN_URL, cookies))).toEqual({
      hasToken: true,
    });
  });

  it('asks for an address when the page is opened without a token', () => {
    expect(load(buildLoadEvent(NO_TOKEN_URL))).toEqual({hasToken: false});
  });

  // A day-long cookie can outlive the link it was set for, so the login
  // screen's "forgot password" link asks for the request form outright.
  it('drops the token cookie and shows the request form for ?request', () => {
    const {cookies, jar} = fakeCookieJar({[TOKEN_COOKIE]: TOKEN});

    expect(() =>
      load(buildLoadEvent(`${NO_TOKEN_URL}?request`, cookies)),
    ).toThrow(
      expect.objectContaining({
        status: 303,
        location: '/staff/password-reset',
      }) as Error,
    );
    expect(jar.has(TOKEN_COOKIE)).toBe(false);
  });

  it('treats an empty token as no token at all', () => {
    const {cookies, jar} = fakeCookieJar();

    expect(() =>
      load(buildLoadEvent(`${NO_TOKEN_URL}?token=`, cookies)),
    ).toThrow(expect.objectContaining({status: 303}) as Error);
    expect(jar.has(TOKEN_COOKIE)).toBe(false);
  });
});

describe('staff password reset +page.server action', () => {
  it('sets the password and sends the staff member to the login screen', async () => {
    const requests: RecordedRequest[] = [];
    const {cookies, jar} = fakeCookieJar({
      [TOKEN_COOKIE]: TOKEN,
      staff_session: 'someone-elses-session',
    });
    const event = buildActionEvent(
      fakeApi(200, requests),
      passwordForm(),
      cookies,
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?reset=done',
    } satisfies Partial<Redirect>);
    expect(requests).toEqual([
      {
        method: 'POST',
        url: CONFIRM_PATH,
        body: {token: TOKEN, newPassword: 'newstaffpassword1'},
      },
    ]);
    // The spent token goes. The browser's staff cookie may belong to another
    // account than the one just reset (the link opened in someone else's
    // browser), so it is left for the API to refuse rather than dropped here.
    expect(jar.has(TOKEN_COOKIE)).toBe(false);
    expect(jar.get('staff_session')).toBe('someone-elses-session');
  });

  it('asks the API to mail a reset link when there is no token', async () => {
    const requests: FakeRequest[] = [];
    const event = buildActionEvent(
      fakeApi(200, undefined, requests),
      requestForm('Staff@Example.com', 'general'),
      fakeCookieJar().cookies,
    );

    await expect(actions.default(event)).resolves.toEqual({sent: true});
    expect(requests.map(r => [r.url, r.body])).toEqual([
      [REQUEST_PATH, {email: 'staff@example.com', scope: 'general'}],
    ]);
    expect(requests[0].headers.get('cf-turnstile-response')).toBe(
      'a-turnstile-token',
    );
  });

  it('sends the request form to the request API even with a stale token cookie', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent(fakeApi(200, requests), requestForm());

    await expect(actions.default(event)).resolves.toEqual({sent: true});
    expect(requests.map(r => r.url)).toEqual([REQUEST_PATH]);
  });

  it('refuses the password form without calling the API when there is no token', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi(200, requests),
      passwordForm(),
      fakeCookieJar().cookies,
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {tokenRejected: true},
    });
    expect(requests).toEqual([]);
  });

  it('fails with 400 without calling the API when the scope is missing', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi(200, requests),
      requestForm('staff@example.com', ''),
      fakeCookieJar().cookies,
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(requests).toEqual([]);
  });

  it('asks the staff member to wait when the API rate limits the request', async () => {
    const event = buildActionEvent(
      fakeApi(429),
      requestForm(),
      fakeCookieJar().cookies,
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 429,
      data: {
        error: '送信が集中しています。しばらく待ってから再度お試しください',
      },
    });
  });

  it('reports a refused Turnstile token as something to retry', async () => {
    const event = buildActionEvent(
      fakeApi(400),
      requestForm(),
      fakeCookieJar().cookies,
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {error: expect.stringContaining('私はロボットではありません')},
    });
  });

  it('fails with 502 when the request cannot be sent', async () => {
    const event = buildActionEvent(
      fakeApi(500),
      requestForm(),
      fakeCookieJar().cookies,
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });

  it('fails with 400 without calling the API when the two passwords differ', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi(200, requests),
      passwordForm('newstaffpassword1', 'newstaffpassword2'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'パスワードが一致しません'},
    });
    expect(requests).toEqual([]);
  });

  it('names the rule a too-common password broke, without calling the API', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi(200, requests),
      passwordForm('qwertyuiop'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          'よく使われているパスワードのため使用できません。別のパスワードを入力してください',
      },
    });
    expect(requests).toEqual([]);
  });

  it('fails with 400 without calling the API when the password is too short', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent(
      fakeApi(200, requests),
      passwordForm('short'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(requests).toEqual([]);
  });

  it('points at a new request and drops the token when the link is no longer usable', async () => {
    const {cookies, jar} = fakeCookieJar({[TOKEN_COOKIE]: TOKEN});
    const event = buildActionEvent(fakeApi(400), passwordForm(), cookies);

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定を申し込むか、統括スタッフにリンクの再発行を依頼してください',
        tokenRejected: true,
      },
    });
    expect(jar.has(TOKEN_COOKIE)).toBe(false);
  });

  it('fails with 502 when the confirm request fails', async () => {
    const event = buildActionEvent(fakeApi(500), passwordForm());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});
