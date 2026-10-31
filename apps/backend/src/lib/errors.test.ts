import {afterEach, beforeEach, describe, expect, it, spyOn} from 'bun:test';
import {ENTRY_ERROR_CODES} from '@regional-quiz/shared';
import {Hono, type TypedResponse} from 'hono';
import {respondFailure, type InternalFailure, type LibFailure} from './errors';

/** Answers a request with `failure`, the way a route does. */
async function request(
  failure: LibFailure<400 | 403 | 404>,
): Promise<{status: number; body: unknown}> {
  const app = new Hono().get('/', c =>
    respondFailure(c, failure, 'failed to do the thing'),
  );
  const res = await app.request('/');
  return {status: res.status, body: await res.json()};
}

describe('respondFailure', () => {
  let consoleError: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleError = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('answers a refusal with its code and status', async () => {
    const {status, body} = await request({
      ok: false,
      status: 404,
      error: ENTRY_ERROR_CODES.ENTRY_NOT_FOUND,
    });

    expect(status).toBe(404);
    expect(body).toEqual({error: 'entry not found'});
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps a code built from the entry status as it is', async () => {
    const {status, body} = await request({
      ok: false,
      status: 403,
      error: 'entry is cancelled',
    });

    expect(status).toBe(403);
    expect(body).toEqual({error: 'entry is cancelled'});
  });

  it('keeps a custom field message, field key included', async () => {
    const {status, body} = await request({
      ok: false,
      status: 400,
      error: 'custom field is required: shirt_size',
    });

    expect(status).toBe(400);
    expect(body).toEqual({
      error: 'custom field is required: shirt_size',
    });
  });

  it('logs a fault and keeps its message out of the response', async () => {
    const {status, body} = await request({
      ok: false,
      status: 500,
      error: 'relation "entries" does not exist',
    });

    expect(status).toBe(500);
    expect(body).toEqual({error: 'internal server error'});
    expect(consoleError).toHaveBeenCalledWith(
      'failed to do the thing',
      'relation "entries" does not exist',
    );
  });
});

// Checked by `tsc --noEmit`, which is what keeps a database message out of a
// 4xx: nothing at runtime tells one string from another.
describe('LibFailure', () => {
  it('holds only a code in a refusal, and free text only in a 500', () => {
    const failures: Array<LibFailure<400 | 403>> = [
      {ok: false, status: 500, error: 'duplicate key value'},
      {ok: false, status: 403, error: ENTRY_ERROR_CODES.ENTRIES_PAUSED},
      // @ts-expect-error A free string can't be a refusal's `error`.
      {ok: false, status: 400, error: 'duplicate key value'},
      // @ts-expect-error `entry is` only takes an entry status.
      {ok: false, status: 403, error: 'entry is whatever'},
      // @ts-expect-error A custom field message starts with a known reason.
      {ok: false, status: 400, error: 'duplicate key value: shirt_size'},
      // @ts-expect-error 404 is not one of the statuses declared here.
      {ok: false, status: 404, error: ENTRY_ERROR_CODES.ENTRY_NOT_FOUND},
    ];

    expect(failures).toHaveLength(6);
  });

  it('adds only the 500 to the type of a route with no refusals', () => {
    type StatusOf<R> =
      R extends TypedResponse<unknown, infer S, 'json'> ? S : never;
    type Statuses = StatusOf<ReturnType<typeof respondFailure<never>>>;

    const internal: InternalFailure = {ok: false, status: 500, error: 'down'};
    const status: Statuses = internal.status;
    // @ts-expect-error No refusal, so no 4xx.
    const refusal: Statuses = 404;

    expect<unknown[]>([status, refusal]).toEqual([500, 404]);
  });
});
