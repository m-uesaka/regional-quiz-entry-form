import {describe, expect, it} from 'vitest';
import {createApiClient} from './api';

describe('createApiClient', () => {
  it('builds a client that issues requests through the given fetch implementation', async () => {
    const fetchCalls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({ok: true}), {
        headers: {'Content-Type': 'application/json'},
      });
    }) as typeof fetch;

    const api = createApiClient(fakeFetch);
    const res = await api.healthz.$get();

    expect(await res.json()).toEqual({ok: true});
    expect(fetchCalls).toEqual(['/api/healthz']);
  });
});
