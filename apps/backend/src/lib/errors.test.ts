import {afterEach, beforeEach, describe, expect, it, spyOn} from 'bun:test';
import {COMMON_ERROR_CODES, ENTRY_ERROR_CODES} from '@regional-quiz/shared';
import {Hono} from 'hono';
import {
  respondFailure,
  UnexpectedFailure,
  unwrap,
  type ClientFailure,
} from './errors';

/** Answers a request with `failure`, the way a route does. */
async function request(
  failure: ClientFailure<400 | 403 | 404>,
): Promise<{status: number; body: unknown}> {
  const app = new Hono().get('/', c => respondFailure(c, failure));
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
      error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND,
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
});

// Checked by `tsc --noEmit`, which is what keeps a database message out of a
// 4xx: nothing at runtime tells one string from another.
describe('ClientFailure', () => {
  it('holds only a code in a refusal', () => {
    const failures: Array<ClientFailure<400 | 403>> = [
      {ok: false, status: 403, error: ENTRY_ERROR_CODES.ENTRIES_PAUSED},
      // @ts-expect-error A free string can't be a refusal's `error`.
      {ok: false, status: 400, error: 'duplicate key value'},
      // @ts-expect-error `entry is` only takes an entry status.
      {ok: false, status: 403, error: 'entry is whatever'},
      // @ts-expect-error A custom field message starts with a known reason.
      {ok: false, status: 400, error: 'duplicate key value: shirt_size'},
      // @ts-expect-error 404 is not one of the statuses declared here.
      {ok: false, status: 404, error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND},
    ];

    expect(failures).toHaveLength(5);
  });
});

describe('unwrap', () => {
  it('gives the data of a query that worked', () => {
    expect(unwrap({data: [1, 2], error: null}, 'failed to read')).toEqual([
      1, 2,
    ]);
    expect(unwrap({data: null, error: null}, 'failed to read')).toBeNull();
  });

  it('throws a failed query with its context and the error', () => {
    const error = {message: 'relation "entries" does not exist', code: '42P01'};

    let thrown: unknown;
    try {
      unwrap({data: null, error}, 'failed to read the entries');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(UnexpectedFailure);
    expect(thrown).toMatchObject({
      context: 'failed to read the entries',
      cause: error,
      message: 'failed to read the entries: relation "entries" does not exist',
    });
  });
});
