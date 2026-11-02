import {describe, expect, it} from 'vitest';
import type {ActionFailure, Cookies, Redirect} from '@sveltejs/kit';
import {fakeCookieJar} from '../../test-support/fake-cookies';
import {fakeFetch, type RecordedRequest} from '../../test-support/fake-fetch';
import {
  fakePlatform,
  TOKYO_SAIKYOI_LIST_KEY,
} from '../../test-support/fake-platform';
import {actions, load} from './+page.server';

const COOKIE_NAME = 'entry_verification_token';
const OUTCOME_COOKIE_NAME = 'entry_verification_outcome';

/** Builds a fake `fetch` answering the single verify call the action makes. */
function fakeApi(options: {
  status?: number;
  body?: unknown;
  /** Collects the requests sent. */
  requests?: RecordedRequest[];
}): typeof fetch {
  return fakeFetch(
    [{status: options.status ?? 200, body: options.body ?? {}}],
    options.requests,
  );
}

type LoadEvent = Parameters<typeof load>[0];
type ActionEvent = Parameters<typeof actions.default>[0];

function buildLoadEvent(cookies: Cookies, search = ''): LoadEvent {
  return {
    url: new URL(`http://localhost/verify${search}`),
    cookies,
  } as unknown as LoadEvent;
}

function buildActionEvent(options: {
  cookies: Cookies;
  fetch: typeof fetch;
  platform?: App.Platform;
}): ActionEvent {
  return {
    url: new URL('http://localhost/verify'),
    cookies: options.cookies,
    fetch: options.fetch,
    platform: options.platform,
  } as unknown as ActionEvent;
}

describe('verify +page.server load (opening the mailed link)', () => {
  it('moves the token into a /verify cookie and redirects to the bare URL', () => {
    const {cookies, jar, setOptions} = fakeCookieJar();

    expect(() => load(buildLoadEvent(cookies, '?token=abc123'))).toThrowError(
      expect.objectContaining({
        status: 303,
        location: '/verify',
      } satisfies Partial<Redirect>),
    );
    expect(jar.get(COOKIE_NAME)).toBe('abc123');
    expect(setOptions.get(COOKIE_NAME)).toMatchObject({
      path: '/verify',
      httpOnly: true,
      maxAge: 24 * 60 * 60,
    });
  });

  // The point of #190: whatever fetches the link -- the participant, or a
  // mail scanner before them -- only gets the confirm button.
  it('offers the confirm button for a held token without calling the API', () => {
    const {cookies} = fakeCookieJar({[COOKIE_NAME]: 'abc123'});

    expect(load(buildLoadEvent(cookies))).toEqual({status: 'ready'});
  });

  it.each(['confirmed', 'waitlisted', 'invalid'] as const)(
    'renders the %s outcome',
    status => {
      const {cookies} = fakeCookieJar();

      expect(load(buildLoadEvent(cookies, `?status=${status}`))).toEqual({
        status,
      });
    },
  );

  // Back from the outcome lands on the bare `/verify` the button was on, and
  // the token is spent by then: it must not call the link invalid.
  it.each(['confirmed', 'waitlisted'] as const)(
    'shows the last %s outcome on the bare URL once the token is spent',
    status => {
      const {cookies} = fakeCookieJar({[OUTCOME_COOKIE_NAME]: status});

      expect(load(buildLoadEvent(cookies))).toEqual({status});
    },
  );

  it('offers the button for a newly opened link over an earlier outcome', () => {
    const {cookies} = fakeCookieJar({
      [COOKIE_NAME]: 'abc123',
      [OUTCOME_COOKIE_NAME]: 'confirmed',
    });

    expect(load(buildLoadEvent(cookies))).toEqual({status: 'ready'});
  });

  it('ignores an outcome cookie it does not recognise', () => {
    const {cookies} = fakeCookieJar({[OUTCOME_COOKIE_NAME]: 'nope'});

    expect(load(buildLoadEvent(cookies))).toEqual({status: 'invalid'});
  });

  it('falls back to invalid with neither a token nor an outcome', () => {
    const {cookies} = fakeCookieJar();

    expect(load(buildLoadEvent(cookies))).toEqual({status: 'invalid'});
  });

  it('falls back to invalid for an unrecognised status', () => {
    const {cookies} = fakeCookieJar();

    expect(load(buildLoadEvent(cookies, '?status=nope'))).toEqual({
      status: 'invalid',
    });
  });
});

describe('verify +page.server action (pressing the confirm button)', () => {
  it('POSTs the held token and redirects to the token-less outcome', async () => {
    const {cookies, jar, setOptions} = fakeCookieJar({
      [COOKIE_NAME]: 'abc123',
    });
    const requests: RecordedRequest[] = [];
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({
        body: {status: 'confirmed', tournament: null},
        requests,
      }),
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=confirmed',
    } satisfies Partial<Redirect>);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain('/api/entries/verify');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toEqual({
      token: 'abc123',
    });
    // Spent, so a later visit doesn't offer the button for it again.
    expect(jar.has(COOKIE_NAME)).toBe(false);
    expect(jar.get(OUTCOME_COOKIE_NAME)).toBe('confirmed');
    expect(setOptions.get(OUTCOME_COOKIE_NAME)).toMatchObject({
      path: '/verify',
      httpOnly: true,
    });
  });

  it('redirects with waitlisted when the tournament was full', async () => {
    const {cookies} = fakeCookieJar({[COOKIE_NAME]: 'abc123'});
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({body: {status: 'waitlisted', tournament: null}}),
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=waitlisted',
    } satisfies Partial<Redirect>);
  });

  it('drops the cached public list the entry now appears on (#125)', async () => {
    const {platform, stored} = fakePlatform();
    stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json([]));
    const {cookies} = fakeCookieJar({[COOKIE_NAME]: 'abc123'});
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({
        body: {
          status: 'confirmed',
          tournament: {regionSlug: 'tokyo', type: 'saikyoi'},
        },
      }),
      platform,
    });

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(false);
  });

  it('keeps the cached list when the backend cannot name the tournament', async () => {
    const {platform, stored} = fakePlatform();
    stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json([]));
    const {cookies} = fakeCookieJar({[COOKIE_NAME]: 'abc123'});
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({body: {status: 'confirmed', tournament: null}}),
      platform,
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=confirmed',
    } satisfies Partial<Redirect>);
    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(true);
  });

  it('redirects with invalid and drops the token the backend refuses', async () => {
    const {cookies, jar} = fakeCookieJar({[COOKIE_NAME]: 'abc123'});
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({
        status: 400,
        body: {error: 'invalid or expired token'},
      }),
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=invalid',
    } satisfies Partial<Redirect>);
    expect(jar.has(COOKIE_NAME)).toBe(false);
    expect(jar.get(OUTCOME_COOKIE_NAME)).toBe('invalid');
  });

  it('keeps the token for another try when the backend fails', async () => {
    // A 500 means the token may still be good, so it must not be reported to
    // the participant as a dead link.
    const {cookies, jar} = fakeCookieJar({[COOKIE_NAME]: 'abc123'});
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({status: 500, body: {error: 'boom'}}),
    });

    const result = (await actions.default(event)) as ActionFailure<{
      error: string;
    }>;
    expect(result.status).toBe(502);
    expect(result.data.error).toContain('もう一度お試しください');
    expect(jar.get(COOKIE_NAME)).toBe('abc123');
    expect(jar.has(OUTCOME_COOKIE_NAME)).toBe(false);
  });

  it('redirects with invalid without calling the API when no token is held', async () => {
    const requests: RecordedRequest[] = [];
    const {cookies} = fakeCookieJar();
    const event = buildActionEvent({
      cookies,
      fetch: fakeApi({requests}),
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=invalid',
    } satisfies Partial<Redirect>);
    expect(requests).toEqual([]);
  });
});
