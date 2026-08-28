import {describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {clientIp, emailKey, rateLimit} from './rate-limit';
import type {Bindings, Env} from '../types/env';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';

const ENV: Bindings = {
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

/**
 * A limiter that records every key it was asked about and allows the first
 * `budget` of them.
 * @param budget How many calls succeed before the rest are refused.
 */
function recordingRateLimiter(budget = Number.POSITIVE_INFINITY): {
  binding: RateLimit;
  keys: string[];
} {
  const keys: string[] = [];
  return {
    keys,
    binding: {
      limit: ({key}: {key?: string}) => {
        keys.push(key ?? '');
        return Promise.resolve({success: keys.length <= budget});
      },
    },
  };
}

describe('rateLimit', () => {
  it('answers 429 with Retry-After once the limiter refuses', async () => {
    const {binding} = recordingRateLimiter(0);
    const app = new Hono<Env>().get(
      '/x',
      rateLimit(
        env => env.LOGIN_IP_RATE_LIMITER,
        () => 'ip:1.2.3.4',
        60,
      ),
      c => c.json({reached: true}),
    );

    const res = await app.request(
      '/x',
      {},
      {...ENV, LOGIN_IP_RATE_LIMITER: binding},
    );

    const body: unknown = await res.json();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(body).toEqual({error: 'too many requests'});
  });

  it('runs the handler while the limiter allows the key', async () => {
    const {binding, keys} = recordingRateLimiter();
    const app = new Hono<Env>().get(
      '/x',
      rateLimit(
        env => env.LOGIN_IP_RATE_LIMITER,
        c => `ip:${clientIp(c)}`,
        60,
      ),
      c => c.json({reached: true}),
    );

    const res = await app.request(
      '/x',
      {headers: {'cf-connecting-ip': '203.0.113.7'}},
      {...ENV, LOGIN_IP_RATE_LIMITER: binding},
    );

    const body: unknown = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({reached: true});
    expect(keys).toEqual(['ip:203.0.113.7']);
  });

  it('keys IP and email separately', async () => {
    // One address trying many accounts and many addresses trying one
    // account are different attacks, and only one key sees each of them.
    // Whether or not the two limits share a limiter, the `ip:` / `email:`
    // prefixes are what keep them out of one another's bucket.
    const {binding, keys} = recordingRateLimiter();
    const app = new Hono<Env>().post(
      '/login',
      rateLimit(
        env => env.LOGIN_IP_RATE_LIMITER,
        c => `ip:${clientIp(c)}`,
        60,
      ),
      zValidator('json', z.object({email: z.string().email()})),
      rateLimit<{out: {json: {email: string}}}>(
        env => env.LOGIN_IP_RATE_LIMITER,
        c => `email:${c.req.valid('json').email}`,
        60,
      ),
      c => c.json({ok: true}),
    );

    const res = await app.request(
      '/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '203.0.113.7',
        },
        body: JSON.stringify({email: 'participant@example.com'}),
      },
      {...ENV, LOGIN_IP_RATE_LIMITER: binding},
    );

    expect(res.status).toBe(200);
    expect(keys).toEqual(['ip:203.0.113.7', 'email:participant@example.com']);
  });

  it('never reaches the handler when the first key is refused', async () => {
    // The email key is only counted against once the IP key has passed, so
    // an attacker cannot spend someone else's email budget from a refused
    // address.
    const {binding, keys} = recordingRateLimiter(0);
    const app = new Hono<Env>().post(
      '/login',
      rateLimit(
        env => env.LOGIN_IP_RATE_LIMITER,
        c => `ip:${clientIp(c)}`,
        60,
      ),
      zValidator('json', z.object({email: z.string().email()})),
      rateLimit<{out: {json: {email: string}}}>(
        env => env.LOGIN_IP_RATE_LIMITER,
        c => `email:${c.req.valid('json').email}`,
        60,
      ),
      c => c.json({ok: true}),
    );

    const res = await app.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: 'participant@example.com'}),
      },
      {...ENV, LOGIN_IP_RATE_LIMITER: binding},
    );

    expect(res.status).toBe(429);
    expect(keys).toEqual(['ip:unknown']);
  });
});

describe('emailKey', () => {
  it('folds the case of the address', () => {
    // One mailbox, so one bucket. Counted as submitted, the two spellings
    // would give a caller twice the budget the endpoint advertises -- and as
    // many times again as they care to vary the capitalization.
    expect(emailKey('Victim@Example.com')).toBe(emailKey('victim@example.com'));
    expect(emailKey('Victim@Example.com')).toBe('email:victim@example.com');
  });
});

describe('clientIp', () => {
  it('reads CF-Connecting-IP', async () => {
    const app = new Hono<Env>().get('/x', c => c.json({ip: clientIp(c)}));

    const res = await app.request(
      '/x',
      {headers: {'cf-connecting-ip': '198.51.100.4'}},
      ENV,
    );

    const body: unknown = await res.json();
    expect(body).toEqual({ip: '198.51.100.4'});
  });

  it('falls back when CF-Connecting-IP is absent', async () => {
    // Only happens off Cloudflare's edge (`wrangler dev`), where a single
    // shared bucket is the right answer -- and, crucially, not a crash.
    const app = new Hono<Env>().get('/x', c => c.json({ip: clientIp(c)}));

    const res = await app.request('/x', {}, ENV);

    const body: unknown = await res.json();
    expect(body).toEqual({ip: 'unknown'});
  });
});
