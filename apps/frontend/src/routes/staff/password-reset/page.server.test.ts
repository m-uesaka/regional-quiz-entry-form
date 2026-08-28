import {describe, expect, it} from 'vitest';
import type {Redirect} from '@sveltejs/kit';
import {actions, load} from './+page.server';

const TOKEN = 'c0ffee01';
const RESET_URL = `http://localhost/staff/password-reset?token=${TOKEN}`;
const NO_TOKEN_URL = 'http://localhost/staff/password-reset';

interface FetchLog {
  urls: string[];
  bodies: unknown[];
}

/** Builds a fake `fetch` answering the confirm POST with the given status. */
function fakeFetch(
  status = 200,
  log: FetchLog = {urls: [], bodies: []},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    log.urls.push(String(input));
    log.bodies.push(JSON.parse(String(init?.body)));
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

/** Builds the partial `RequestEvent` the form action needs. */
function buildActionEvent(
  url: string,
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    url: new URL(url),
    fetch: fetchImpl,
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
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
  it('shows the password form when the mailed link carries a token', () => {
    expect(load(buildLoadEvent(RESET_URL))).toEqual({hasToken: true});
  });

  it('has nothing to offer when the page is opened without a token', () => {
    expect(load(buildLoadEvent(NO_TOKEN_URL))).toEqual({hasToken: false});
  });

  it('treats an empty token as no token at all', () => {
    expect(load(buildLoadEvent(`${NO_TOKEN_URL}?token=`))).toEqual({
      hasToken: false,
    });
  });
});

describe('staff password reset +page.server action', () => {
  it('sets the password and sends the staff member to the login screen', async () => {
    const log: FetchLog = {urls: [], bodies: []};
    const event = buildActionEvent(
      RESET_URL,
      fakeFetch(200, log),
      passwordForm(),
    );

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?reset=done',
    } satisfies Partial<Redirect>);
    expect(log.urls[0]).toContain('/api/auth/staff/password-reset/confirm');
    expect(log.bodies).toEqual([
      {token: TOKEN, newPassword: 'newstaffpassword1'},
    ]);
  });

  it('fails with 400 without calling the API when there is no token', async () => {
    const log: FetchLog = {urls: [], bodies: []};
    const event = buildActionEvent(
      NO_TOKEN_URL,
      fakeFetch(200, log),
      passwordForm(),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.urls).toEqual([]);
  });

  it('fails with 400 without calling the API when the two passwords differ', async () => {
    const log: FetchLog = {urls: [], bodies: []};
    const event = buildActionEvent(
      RESET_URL,
      fakeFetch(200, log),
      passwordForm('newstaffpassword1', 'newstaffpassword2'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {error: 'パスワードが一致しません'},
    });
    expect(log.urls).toEqual([]);
  });

  it('fails with 400 without calling the API when the password is too short', async () => {
    const log: FetchLog = {urls: [], bodies: []};
    const event = buildActionEvent(
      RESET_URL,
      fakeFetch(200, log),
      passwordForm('short'),
    );

    await expect(actions.default(event)).resolves.toMatchObject({status: 400});
    expect(log.urls).toEqual([]);
  });

  it('points at the general staff when the link is no longer usable', async () => {
    const event = buildActionEvent(RESET_URL, fakeFetch(400), passwordForm());

    await expect(actions.default(event)).resolves.toMatchObject({
      status: 400,
      data: {
        error:
          'このリンクは無効か、有効期限が切れています。管理スタッフにリンクの再発行を依頼してください',
      },
    });
  });

  it('fails with 502 when the confirm request fails', async () => {
    const event = buildActionEvent(RESET_URL, fakeFetch(500), passwordForm());

    await expect(actions.default(event)).resolves.toMatchObject({status: 502});
  });
});
