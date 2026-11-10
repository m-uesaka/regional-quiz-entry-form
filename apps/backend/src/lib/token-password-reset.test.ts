import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {createDbClient} from './db';
import {COMMON_ERROR_CODES} from '@regional-quiz/shared';
import {testBindings} from '../test-support/bindings';
import {verifyPassword} from './password';
import {INVALID_TOKEN_SQLSTATE} from './pg-errors';
import {hashToken} from './token';
import {
  confirmTokenPasswordReset,
  type TokenPasswordResetTarget,
} from './token-password-reset';

const env = testBindings();

const TOKEN = 'raw-reset-token';
const NEW_PASSWORD = 'a-brand-new-password';

const POSTGREST_ERROR = {
  message: 'connection terminated',
  details: null,
  hint: null,
  code: '57P01',
};

/** A request the mock below received. */
interface RecordedRequest {
  url: URL;
  body: unknown;
}

const TARGETS: TokenPasswordResetTarget[] = [
  {tokenTable: 'password_reset_tokens', rpc: 'reset_participant_password'},
  {tokenTable: 'staff_password_reset_tokens', rpc: 'reset_staff_password'},
];

for (const target of TARGETS) {
  describe(`confirmTokenPasswordReset (${target.rpc}, mocked Supabase)`, () => {
    const originalFetch = globalThis.fetch;
    let requests: RecordedRequest[];

    /**
     * Answers the token read with `read` and the redeeming call with `rpc`.
     * @param read Builds the response to the token read.
     * @param rpc Builds the response to the redeeming call.
     */
    function mockFetch(read: () => Response, rpc: () => Response): void {
      globalThis.fetch = ((
        input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        const url = new URL(String(input));
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Promise.resolve(
          url.pathname.startsWith('/rest/v1/rpc/') ? rpc() : read(),
        );
      }) as unknown as typeof fetch;
    }

    let unexpectedCalls: number;

    /**
     * The response to a request the test expects never to be sent. Counted
     * rather than thrown: supabase-js turns a throwing `fetch` into an error
     * result, which the code under test would handle like any other.
     */
    function unexpected(): Response {
      unexpectedCalls++;
      return Response.json(POSTGREST_ERROR, {status: 500});
    }

    beforeEach(() => {
      requests = [];
      unexpectedCalls = 0;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      expect(unexpectedCalls).toBe(0);
    });

    it('reads the live token from its own table before anything else', async () => {
      mockFetch(
        () => Response.json([]),
        () => unexpected(),
      );

      await confirmTokenPasswordReset(createDbClient(env), target, {
        token: TOKEN,
        newPassword: NEW_PASSWORD,
      });

      expect(requests[0].url.pathname).toBe(`/rest/v1/${target.tokenTable}`);
      const params = requests[0].url.searchParams;
      expect(params.get('token_hash')).toBe(`eq.${await hashToken(TOKEN)}`);
      expect(params.get('used_at')).toBe('is.null');
      expect(params.get('expires_at')).toStartWith('gt.');
    });

    it('refuses an unknown token without calling the redeeming function', async () => {
      mockFetch(
        () => Response.json([]),
        () => unexpected(),
      );

      const result = await confirmTokenPasswordReset(
        createDbClient(env),
        target,
        {
          token: TOKEN,
          newPassword: NEW_PASSWORD,
        },
      );

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
      expect(requests).toHaveLength(1);
    });

    it('reports a failed token read as a server fault, not a bad token', async () => {
      mockFetch(
        () => Response.json(POSTGREST_ERROR, {status: 500}),
        () => unexpected(),
      );

      await expect(
        confirmTokenPasswordReset(createDbClient(env), target, {
          token: TOKEN,
          newPassword: NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        context: 'failed to read the reset token',
        cause: POSTGREST_ERROR,
      });
      expect(requests).toHaveLength(1);
    });

    it('redeems a live token with the hash of the new password', async () => {
      mockFetch(
        () => Response.json([{id: 'token-id'}]),
        () => new Response(null, {status: 204}),
      );

      const result = await confirmTokenPasswordReset(
        createDbClient(env),
        target,
        {
          token: TOKEN,
          newPassword: NEW_PASSWORD,
        },
      );

      expect(result).toEqual({ok: true});
      expect(requests).toHaveLength(2);
      expect(requests[1].url.pathname).toBe(`/rest/v1/rpc/${target.rpc}`);
      const body = requests[1].body as {
        p_token_hash: string;
        p_password_hash: string;
      };
      expect(body.p_token_hash).toBe(await hashToken(TOKEN));
      expect(
        (await verifyPassword(NEW_PASSWORD, body.p_password_hash)).valid,
      ).toBe(true);
    });

    it('refuses a token the redeeming function finds used or expired', async () => {
      mockFetch(
        () => Response.json([{id: 'token-id'}]),
        () =>
          Response.json(
            {
              message: 'invalid or expired token',
              details: null,
              hint: null,
              code: INVALID_TOKEN_SQLSTATE,
            },
            {status: 400},
          ),
      );

      const result = await confirmTokenPasswordReset(
        createDbClient(env),
        target,
        {
          token: TOKEN,
          newPassword: NEW_PASSWORD,
        },
      );

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });

    it('reports any other failure of the redeeming function as a server fault', async () => {
      mockFetch(
        () => Response.json([{id: 'token-id'}]),
        () => Response.json(POSTGREST_ERROR, {status: 500}),
      );

      await expect(
        confirmTokenPasswordReset(createDbClient(env), target, {
          token: TOKEN,
          newPassword: NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        context: 'failed to reset the password',
        cause: POSTGREST_ERROR,
      });
    });
  });
}
