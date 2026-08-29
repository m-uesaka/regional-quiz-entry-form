import {describe, expect, it} from 'bun:test';
import {app} from './index';

describe('GET /api/healthz', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/healthz');
    // `Response#json()` types as `Promise<any>`; annotate as `unknown` so
    // `expect()` resolves its generic overload instead of the `never` one.
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ok: true});
  });
});
