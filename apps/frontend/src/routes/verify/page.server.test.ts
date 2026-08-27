import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import {load} from './+page.server';

/** Builds a fake `fetch` answering the single verify call `load` makes. */
function fakeFetch(options: {
  status?: number;
  body?: unknown;
  onUrl?: (url: string) => void;
}): typeof fetch {
  return (async input => {
    options.onUrl?.(typeof input === 'string' ? input : input.toString());
    return new Response(JSON.stringify(options.body ?? {}), {
      status: options.status ?? 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  search?: string;
}): Parameters<typeof load>[0] {
  return {
    url: new URL(`http://localhost/verify${options.search ?? ''}`),
    fetch: options.fetch,
  } as Parameters<typeof load>[0];
}

describe('verify +page.server load', () => {
  it('passes the token through to the backend and returns confirmed', async () => {
    const requested: string[] = [];
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({
        body: {status: 'confirmed'},
        onUrl: url => requested.push(url),
      }),
    });

    await expect(load(event)).resolves.toEqual({status: 'confirmed'});
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('/api/entries/verify');
    expect(
      new URL(requested[0], 'http://localhost').searchParams.get('token'),
    ).toBe('abc123');
  });

  it('returns waitlisted when the tournament was full', async () => {
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({body: {status: 'waitlisted'}}),
    });

    await expect(load(event)).resolves.toEqual({status: 'waitlisted'});
  });

  it('returns invalid when the backend rejects the token', async () => {
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({
        status: 400,
        body: {error: 'invalid or expired token'},
      }),
    });

    await expect(load(event)).resolves.toEqual({status: 'invalid'});
  });

  it('returns invalid without calling the backend when the token is missing', async () => {
    let called = false;
    const event = buildEvent({
      fetch: fakeFetch({onUrl: () => (called = true)}),
    });

    await expect(load(event)).resolves.toEqual({status: 'invalid'});
    expect(called).toBe(false);
  });

  it('throws 502 when the backend fails for another reason', async () => {
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({status: 500, body: {error: 'boom'}}),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
