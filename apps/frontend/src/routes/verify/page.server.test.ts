import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
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

describe('verify +page.server load (confirming a token)', () => {
  it('passes the token through and redirects to the token-less result URL', async () => {
    const requested: string[] = [];
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({
        body: {status: 'confirmed'},
        onUrl: url => requested.push(url),
      }),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=confirmed',
    } satisfies Partial<Redirect>);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('/api/entries/verify');
    expect(
      new URL(requested[0], 'http://localhost').searchParams.get('token'),
    ).toBe('abc123');
  });

  it('redirects with waitlisted when the tournament was full', async () => {
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({body: {status: 'waitlisted'}}),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=waitlisted',
    } satisfies Partial<Redirect>);
  });

  it('redirects with invalid when the backend refuses the token', async () => {
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({
        status: 400,
        body: {error: 'invalid or expired token'},
      }),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/verify?status=invalid',
    } satisfies Partial<Redirect>);
  });

  it('throws 502 instead of redirecting when the backend fails', async () => {
    // A 500 means the token may still be good, so it must not be reported to
    // the participant as a dead link.
    const event = buildEvent({
      search: '?token=abc123',
      fetch: fakeFetch({status: 500, body: {error: 'boom'}}),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});

describe('verify +page.server load (rendering a result)', () => {
  it.each(['confirmed', 'waitlisted', 'invalid'] as const)(
    'renders %s without calling the backend again',
    async status => {
      let called = false;
      const event = buildEvent({
        search: `?status=${status}`,
        fetch: fakeFetch({onUrl: () => (called = true)}),
      });

      await expect(load(event)).resolves.toEqual({status});
      expect(called).toBe(false);
    },
  );

  it('falls back to invalid when the query string is missing', async () => {
    const event = buildEvent({fetch: fakeFetch({})});

    await expect(load(event)).resolves.toEqual({status: 'invalid'});
  });

  it('falls back to invalid for an unrecognised status', async () => {
    const event = buildEvent({search: '?status=nope', fetch: fakeFetch({})});

    await expect(load(event)).resolves.toEqual({status: 'invalid'});
  });
});
