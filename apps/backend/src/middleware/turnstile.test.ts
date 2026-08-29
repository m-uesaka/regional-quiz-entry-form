import {afterEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {requireTurnstile, TURNSTILE_TOKEN_HEADER} from './turnstile';
import type {Bindings, Env} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
  TURNSTILE_SECRET_KEY: 'the-secret',
};

const app = new Hono<Env>().post('/x', requireTurnstile(), c =>
  c.json({reached: true}),
);

/** Answers siteverify as Cloudflare would for a good/bad token. */
function mockSiteverify(success: boolean): {secrets: string[]} {
  const secrets: string[] = [];
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {secret: string};
    secrets.push(body.secret);
    return Promise.resolve(Response.json({success}));
  }) as unknown as typeof fetch;
  return {secrets};
}

async function post(headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/x', {method: 'POST', headers}, ENV);
}

describe('requireTurnstile', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes a verified token through to the handler', async () => {
    const {secrets} = mockSiteverify(true);

    const res = await post({[TURNSTILE_TOKEN_HEADER]: 'a-token'});

    const body: unknown = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({reached: true});
    expect(secrets).toEqual(['the-secret']);
  });

  it('answers 400 when the token is missing', async () => {
    // Answered without asking Cloudflare anything: there is nothing to ask
    // about, and a siteverify call per tokenless request would be a second
    // amplification target.
    const {secrets} = mockSiteverify(true);

    const res = await post();

    const body: unknown = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({error: 'turnstile verification failed'});
    expect(secrets).toEqual([]);
  });

  it('answers 400 with the same body when the token is refused', async () => {
    // Deliberately indistinguishable from the missing-token answer: both are
    // fixed by solving the widget again, and telling them apart only helps
    // someone probing what gets through.
    mockSiteverify(false);

    const res = await post({[TURNSTILE_TOKEN_HEADER]: 'a-token'});

    const body: unknown = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({error: 'turnstile verification failed'});
  });

  it('answers 400 when siteverify cannot be reached', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('network down'))) as unknown as typeof fetch;

    const res = await post({[TURNSTILE_TOKEN_HEADER]: 'a-token'});

    expect(res.status).toBe(400);
  });
});
