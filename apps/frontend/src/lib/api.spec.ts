import {describe, expect, it} from 'vitest';
import {createApiClient, readErrorMessage} from './api';

describe('createApiClient', () => {
  it('builds a client that issues requests through the given fetch implementation', async () => {
    const fetchCalls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({ok: true}), {
        headers: {'Content-Type': 'application/json'},
      });
    }) as typeof fetch;

    const client = createApiClient(fakeFetch);
    const res = await client.api.healthz.$get();

    expect(await res.json()).toEqual({ok: true});
    expect(fetchCalls).toEqual(['/api/healthz']);
  });
});

describe('readErrorMessage', () => {
  it('reads the error the backend answered with', async () => {
    const res = new Response(JSON.stringify({error: 'nope'}), {status: 400});

    await expect(readErrorMessage(res, 'fallback')).resolves.toBe('nope');
  });

  it('falls back when the body names no error', async () => {
    for (const body of ['<html>bad gateway</html>', '{}', '{"error": 1}']) {
      await expect(
        readErrorMessage(new Response(body, {status: 502}), 'fallback'),
      ).resolves.toBe('fallback');
    }
  });
});
