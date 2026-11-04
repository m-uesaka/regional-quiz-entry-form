import {describe, expect, it} from 'bun:test';
import {app} from '../index';
import {testBindings} from '../test-support/bindings';

// Rejected by `zValidator()` before any database call, so it runs
// unconditionally (including CI).
const env = testBindings();

describe('POST /entries/verify (request validation)', () => {
  it('rejects a request missing the token with 400', async () => {
    const res = await app.request(
      '/api/entries/verify',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  // A mail scanner or link preview fetching the old link shape must not
  // reach anything that confirms an entry (#190).
  it('does not confirm on a GET carrying the token', async () => {
    const res = await app.request('/api/entries/verify?token=abc', {}, env);

    expect(res.status).toBe(404);
  });
});
