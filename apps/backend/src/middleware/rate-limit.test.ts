import {describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  CLIENT_IP_FORWARD_SECRET_HEADER,
  CLIENT_IP_HEADER,
  clientIp,
  emailKey,
  rateLimit,
} from './rate-limit';
import type {Bindings, Env} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const FORWARD_SECRET = 'test-client-ip-forward-secret';

// The address Cloudflare would name for a subrequest from the frontend.
const FRONTEND_IP = '192.0.2.10';

/**
 * Headers for a request the frontend forwarded on behalf of `ip`.
 * @param ip The browser's address.
 * @param secret What to present as the forwarding secret, if anything.
 */
function forwardedFrom(ip: string, secret?: string): Record<string, string> {
  return {
    'cf-connecting-ip': FRONTEND_IP,
    [CLIENT_IP_HEADER]: ip,
    ...(secret === undefined
      ? {}
      : {[CLIENT_IP_FORWARD_SECRET_HEADER]: secret}),
  };
}

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

  it('gives two forwarded addresses a bucket each', async () => {
    // What #188 was about: every form action reaches the Worker from the
    // frontend, so without the forwarded address two users behind it would
    // be counted as one -- and the second refused once the first had spent
    // the budget.
    const {binding, keys} = recordingRateLimiter();
    const app = new Hono<Env>().post(
      '/login',
      rateLimit(
        env => env.LOGIN_IP_RATE_LIMITER,
        c => `ip:${clientIp(c)}`,
        60,
      ),
      c => c.json({ok: true}),
    );
    const env = {
      ...ENV,
      CLIENT_IP_FORWARD_SECRET: FORWARD_SECRET,
      LOGIN_IP_RATE_LIMITER: binding,
    };

    for (const ip of ['198.51.100.1', '198.51.100.2']) {
      const res = await app.request(
        '/login',
        {method: 'POST', headers: forwardedFrom(ip, FORWARD_SECRET)},
        env,
      );
      expect(res.status).toBe(200);
    }

    expect(keys).toEqual(['ip:198.51.100.1', 'ip:198.51.100.2']);
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

  describe('with a forwarded address', () => {
    const app = new Hono<Env>().get('/x', c => c.json({ip: clientIp(c)}));

    /**
     * What `clientIp()` answers for the given headers and secret.
     * @param headers The request's headers.
     * @param secret `CLIENT_IP_FORWARD_SECRET`, if configured.
     */
    async function ipFor(
      headers: Record<string, string>,
      secret: string | undefined,
    ): Promise<unknown> {
      const res = await app.request(
        '/x',
        {headers},
        {...ENV, CLIENT_IP_FORWARD_SECRET: secret},
      );
      return res.json();
    }

    it('trusts it when the secret matches', async () => {
      await expect(
        ipFor(forwardedFrom('198.51.100.4', FORWARD_SECRET), FORWARD_SECRET),
      ).resolves.toEqual({ip: '198.51.100.4'});
    });

    it('ignores it when the secret is wrong', async () => {
      // A browser can send `X-Client-IP` straight to the Worker's `/api/*`
      // route; believing it would let a caller pick a fresh bucket for
      // every request.
      await expect(
        ipFor(forwardedFrom('198.51.100.4', 'guessed'), FORWARD_SECRET),
      ).resolves.toEqual({ip: FRONTEND_IP});
    });

    it('ignores it when the secret is a prefix of the real one', async () => {
      await expect(
        ipFor(
          forwardedFrom('198.51.100.4', FORWARD_SECRET.slice(0, -1)),
          FORWARD_SECRET,
        ),
      ).resolves.toEqual({ip: FRONTEND_IP});
    });

    it('ignores it when no secret is sent', async () => {
      await expect(
        ipFor(forwardedFrom('198.51.100.4'), FORWARD_SECRET),
      ).resolves.toEqual({ip: FRONTEND_IP});
    });

    it('ignores it when the Worker has no secret configured', async () => {
      // An empty header must not match an unset (or empty) secret.
      await expect(
        ipFor(forwardedFrom('198.51.100.4', ''), undefined),
      ).resolves.toEqual({ip: FRONTEND_IP});
      await expect(
        ipFor(forwardedFrom('198.51.100.4', ''), ''),
      ).resolves.toEqual({ip: FRONTEND_IP});
    });

    it('falls back to unknown when ignored off the edge', async () => {
      await expect(
        ipFor({[CLIENT_IP_HEADER]: '198.51.100.4'}, FORWARD_SECRET),
      ).resolves.toEqual({ip: 'unknown'});
    });
  });
});
