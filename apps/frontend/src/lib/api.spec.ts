import {describe, expect, it} from 'vitest';
import {
  createApiClient,
  pickApiErrorMessage,
  readErrorMessage,
  resolveApiErrorMessage,
} from './api';

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

describe('pickApiErrorMessage', () => {
  const messages = {
    byCode: {known: 'code wording'},
    byStatus: {403: 'status wording'},
    fallback: 'fallback wording',
  };

  it('prefers the wording of the code to that of the status', () => {
    expect(pickApiErrorMessage('known', 403, messages)).toBe('code wording');
  });

  it('falls back to the status for a code it does not know', () => {
    expect(pickApiErrorMessage('unknown', 403, messages)).toBe(
      'status wording',
    );
    expect(pickApiErrorMessage('', 403, messages)).toBe('status wording');
  });

  it('falls back when neither table knows the refusal', () => {
    expect(pickApiErrorMessage('unknown', 500, messages)).toBe(
      'fallback wording',
    );
  });

  it('takes an inherited property name for an unknown code', () => {
    expect(pickApiErrorMessage('constructor', 500, messages)).toBe(
      'fallback wording',
    );
  });

  it('needs neither table', () => {
    expect(pickApiErrorMessage('known', 403, {fallback: 'fallback'})).toBe(
      'fallback',
    );
  });
});

describe('resolveApiErrorMessage', () => {
  const messages = {
    byCode: {known: 'code wording'},
    byStatus: {502: 'status wording'},
    fallback: 'fallback wording',
  };

  it('resolves the code in the body', async () => {
    const res = new Response(JSON.stringify({error: 'known'}), {status: 400});

    await expect(resolveApiErrorMessage(res, messages)).resolves.toBe(
      'code wording',
    );
  });

  it('leaves a non-JSON body to the status', async () => {
    const res = new Response('<html>bad gateway</html>', {status: 502});

    await expect(resolveApiErrorMessage(res, messages)).resolves.toBe(
      'status wording',
    );
  });
});
