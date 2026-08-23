import {describe, expect, it} from 'bun:test';
import {generateToken, hashToken} from './token';

describe('generateToken', () => {
  it('generates a hex string with high entropy', () => {
    const token = generateToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a different token each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('hashToken', () => {
  it('hashes the same token deterministically', async () => {
    const token = generateToken();

    expect(await hashToken(token)).toBe(await hashToken(token));
  });

  it('hashes different tokens to different values', async () => {
    const a = await hashToken(generateToken());
    const b = await hashToken(generateToken());

    expect(a).not.toBe(b);
  });
});
