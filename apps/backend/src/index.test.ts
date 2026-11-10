import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
  type Mock,
} from 'bun:test';
import {COMMON_ERROR_CODES} from '@regional-quiz/shared';
import {app} from './index';
import {testBindings} from './test-support/bindings';
import type {Bindings} from './types/env';

const FRONTEND_URL = 'https://entry.example.com';
const FOREIGN_ORIGIN = 'https://evil.example';

// Only `FRONTEND_URL` matters to the origin check. Nothing below reaches
// Supabase or the mail provider; port 1 makes sure of the former.
const ENV = testBindings({SUPABASE_URL: 'http://127.0.0.1:1', FRONTEND_URL});

// A state-changing endpoint that needs neither a session nor a database, so
// what answers is the origin check and nothing else. Posted with no body, it
// looks to `hono/csrf` exactly like a cross-site `<form>` submission would.
const LOGOUT_PATH = '/api/auth/participant/logout';

async function postLogout(
  headers: Record<string, string>,
  env: Bindings = ENV,
): Promise<Response> {
  return await app.request(LOGOUT_PATH, {method: 'POST', headers}, env);
}

describe('GET /api/healthz', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/healthz', {}, testBindings());
    // `Response#json()` types as `Promise<any>`; annotate as `unknown` so
    // `expect()` resolves its generic overload instead of the `never` one.
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ok: true});
  });
});

describe('origin check (#120)', () => {
  it('a state-changing request from a foreign origin is refused', async () => {
    const res = await postLogout({origin: FOREIGN_ORIGIN});

    expect(res.status).toBe(403);
    // Refused before the handler ran, so no cookie was touched.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a form-encoded request from a foreign origin is refused', async () => {
    const res = await postLogout({
      origin: FOREIGN_ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(res.status).toBe(403);
  });

  it('a state-changing request with no origin at all is refused', async () => {
    const res = await postLogout({});

    expect(res.status).toBe(403);
  });

  it('a request from FRONTEND_URL is allowed', async () => {
    const res = await postLogout({origin: FRONTEND_URL});

    expect(res.status).toBe(200);
  });

  it('a FRONTEND_URL written with a trailing slash still matches', async () => {
    const res = await postLogout(
      {origin: FRONTEND_URL},
      {...ENV, FRONTEND_URL: `${FRONTEND_URL}/`},
    );

    expect(res.status).toBe(200);
  });

  it('a FRONTEND_URL that is not a URL refuses rather than allows', async () => {
    const res = await postLogout(
      {origin: FRONTEND_URL},
      {...ENV, FRONTEND_URL: 'entry.example.com'},
    );

    expect(res.status).toBe(403);
  });

  // A frontend reached under another address -- `127.0.0.1` beside
  // `localhost` in development, a Pages preview -- sends that address as
  // `Origin`, so it is trusted only once it is listed.
  it('an origin listed in CSRF_TRUSTED_ORIGINS is allowed', async () => {
    const env = {
      ...ENV,
      CSRF_TRUSTED_ORIGINS: 'http://127.0.0.1:5173, https://preview.example/',
    };

    for (const origin of ['http://127.0.0.1:5173', 'https://preview.example']) {
      expect((await postLogout({origin}, env)).status, origin).toBe(200);
    }
    expect((await postLogout({origin: FOREIGN_ORIGIN}, env)).status).toBe(403);
  });

  it('an unlisted second address of the frontend is refused', async () => {
    const res = await postLogout({origin: 'http://127.0.0.1:5173'});

    expect(res.status).toBe(403);
  });

  it('an entry of CSRF_TRUSTED_ORIGINS that is not a URL is ignored', async () => {
    const env = {...ENV, CSRF_TRUSTED_ORIGINS: 'not a url,'};

    expect((await postLogout({origin: FRONTEND_URL}, env)).status).toBe(200);
    expect((await postLogout({origin: 'null'}, env)).status).toBe(403);
  });

  it('a request the browser marks same-origin is allowed', async () => {
    // The browser's own `/api/*` calls go through the route on the frontend
    // host, so the browser marks them same-origin.
    const res = await postLogout({'sec-fetch-site': 'same-origin'});

    expect(res.status).toBe(200);
  });

  it('a GET is not subject to the origin check', async () => {
    const res = await app.request(
      '/api/healthz',
      {headers: {origin: FOREIGN_ORIGIN}},
      ENV,
    );

    expect(res.status).toBe(200);
  });
});

describe('secure headers (#120)', () => {
  it('every response carries the secure headers', async () => {
    const responses = [
      await app.request('/api/healthz', {}, ENV),
      // The origin check's refusal, which is thrown rather than returned.
      await postLogout({origin: FOREIGN_ORIGIN}),
      await app.request('/api/no-such-route', {}, ENV),
    ];

    for (const res of responses) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('strict-transport-security')).toContain(
        'max-age=',
      );
    }
  });
});

// What answers when no route does, or when one fails without answering
// (#294): the API's `{error: string}`, never Hono's plain-text defaults.
describe('error responses (#294)', () => {
  let consoleError: Mock<typeof console.error>;

  beforeEach(() => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('a path no route answers is a JSON 404', async () => {
    for (const path of ['/api/no-such-route', '/no-api-prefix']) {
      const res = await app.request(path, {}, ENV);
      const body: unknown = await res.json();

      expect(res.status, path).toBe(404);
      expect(body).toEqual({error: COMMON_ERROR_CODES.NOT_FOUND});
    }
  });

  it('a handler that throws is a JSON 500, and the cause is logged', async () => {
    // `createClient()` throws on an empty URL: a fault the handler does not
    // catch, standing in for a `XSchema.parse()` that meets an unexpected
    // database value.
    const res = await app.request(
      '/api/portal/tournaments',
      {},
      {...ENV, SUPABASE_URL: ''},
    );
    const body: unknown = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({error: 'internal server error'});
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('a refusal thrown as an HTTPException keeps its own response', async () => {
    // The origin check's 403, thrown by `hono/csrf`.
    const res = await postLogout({origin: FOREIGN_ORIGIN});

    expect(res.status).toBe(403);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('a path parameter failing its schema is {error: invalid request}', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/entry-list',
      {},
      ENV,
    );
    const body: unknown = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({error: COMMON_ERROR_CODES.INVALID_REQUEST});
  });

  it('a JSON body failing its schema is {error: invalid request}', async () => {
    const res = await app.request(
      '/api/auth/staff/login',
      {
        method: 'POST',
        headers: {'content-type': 'application/json', origin: FRONTEND_URL},
        body: JSON.stringify({email: 'not an email'}),
      },
      ENV,
    );
    const body: unknown = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({error: COMMON_ERROR_CODES.INVALID_REQUEST});
  });
});
