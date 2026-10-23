import {describe, expect, it} from 'bun:test';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  isPasswordHashUsable,
  UNUSABLE_PASSWORD_HASH,
  verifyPassword,
} from './password';
import {legacyHashPassword} from '../test-support/password';

describe('hashPassword / verifyPassword', () => {
  it('verifies a matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(
      (await verifyPassword('correct horse battery staple', hash)).valid,
    ).toBe(true);
  });

  it('rejects a non-matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('wrong password', hash)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('rejects a malformed stored hash', async () => {
    expect(
      (await verifyPassword('anything', 'not-a-valid-stored-hash')).valid,
    ).toBe(false);
  });

  it('salts each hash differently for the same password', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');

    expect(a).not.toBe(b);
  });

  it('hashPassword writes the algorithm and iteration count into the stored value', async () => {
    const hash = await hashPassword('a password');

    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  });

  it('verifyPassword accepts a hash stored in the legacy salt:hash format', async () => {
    const legacy = await legacyHashPassword('an old password');

    expect((await verifyPassword('an old password', legacy)).valid).toBe(true);
    expect((await verifyPassword('another password', legacy)).valid).toBe(
      false,
    );
  });

  it('verifyPassword reports needsRehash for a legacy hash', async () => {
    const legacy = await legacyHashPassword('an old password');

    expect(await verifyPassword('an old password', legacy)).toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('verifyPassword reports needsRehash for a hash with fewer iterations than the current count', async () => {
    // The same password and salt, re-labelled with a lower count, would not
    // verify -- so derive a genuine 1,000-iteration hash.
    const salt = new Uint8Array(16);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('a password'),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      {name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256'},
      key,
      256,
    );
    const hex = Array.from(new Uint8Array(bits), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    const stored = `pbkdf2-sha256$1000$${'00'.repeat(16)}$${hex}`;

    expect(await verifyPassword('a password', stored)).toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('verifyPassword does not report needsRehash for a current hash', async () => {
    const hash = await hashPassword('a password');

    expect(await verifyPassword('a password', hash)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('verifyPassword does not report needsRehash for a wrong password against a legacy hash', async () => {
    // Only a caller holding the right plaintext can rehash; reporting it on a
    // failure would invite a write of the wrong password's hash.
    const legacy = await legacyHashPassword('an old password');

    expect(await verifyPassword('not it', legacy)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('verifyPassword rejects a hash naming an unknown algorithm', async () => {
    const hash = await hashPassword('a password');
    const renamed = hash.replace(/^pbkdf2-sha256\$/, 'argon2id$');

    expect(await verifyPassword('a password', renamed)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('reads a count above the Workers cap as unusable rather than throwing', async () => {
    // Cloudflare's edge throws on PBKDF2 above 100,000 iterations, so such a
    // hash must be refused before it reaches `deriveBits()`.
    const [, , salt, digest] = (await hashPassword('a password')).split('$');
    const stored = `pbkdf2-sha256$100001$${salt}$${digest}`;

    expect(isPasswordHashUsable(stored)).toBe(false);
    expect(await verifyPassword('a password', stored)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('verifyPassword rejects a malformed iteration count', async () => {
    const hash = await hashPassword('a password');
    const [, , salt, digest] = hash.split('$');

    for (const iterations of ['', '0', '0100000', '1e5', '-1', '100000.0']) {
      expect(
        (
          await verifyPassword(
            'a password',
            `pbkdf2-sha256$${iterations}$${salt}$${digest}`,
          )
        ).valid,
      ).toBe(false);
    }
  });
});

describe('isPasswordHashUsable', () => {
  it('accepts a hash this module produced', async () => {
    expect(isPasswordHashUsable(await hashPassword('a password'))).toBe(true);
  });

  it('accepts a hash in the legacy salt:hash format', async () => {
    expect(isPasswordHashUsable(await legacyHashPassword('a password'))).toBe(
      true,
    );
  });

  it('rejects the placeholder a not-yet-invited account carries', () => {
    expect(isPasswordHashUsable(UNUSABLE_PASSWORD_HASH)).toBe(false);
  });

  it('rejects a stored value that is malformed in any other way', () => {
    for (const stored of [
      '',
      ':',
      'aa:bb',
      `${'zz'.repeat(16)}:${'00'.repeat(32)}`,
      '$$$',
      `pbkdf2-sha256$100000$${'00'.repeat(16)}`,
      `pbkdf2-sha256$100000$${'00'.repeat(16)}$${'00'.repeat(32)}$extra`,
      `pbkdf2-sha256$100000$${'00'.repeat(15)}$${'00'.repeat(32)}`,
      `pbkdf2-sha256$100000$${'zz'.repeat(16)}$${'00'.repeat(32)}`,
      `pbkdf2-sha256$99999999999$${'00'.repeat(16)}$${'00'.repeat(32)}`,
      `pbkdf2-sha512$100000$${'00'.repeat(16)}$${'00'.repeat(32)}`,
    ]) {
      expect(isPasswordHashUsable(stored)).toBe(false);
    }
  });
});

describe('DUMMY_PASSWORD_HASH', () => {
  it('is a usable hash in the current format, so verifying against it costs what a real one does', async () => {
    const real = await hashPassword('a password');

    expect(isPasswordHashUsable(DUMMY_PASSWORD_HASH)).toBe(true);
    // Same algorithm and iteration count as a freshly made hash.
    expect(DUMMY_PASSWORD_HASH.split('$').slice(0, 2)).toEqual(
      real.split('$').slice(0, 2),
    );
  });

  it('matches no password', async () => {
    expect((await verifyPassword('', DUMMY_PASSWORD_HASH)).valid).toBe(false);
    expect((await verifyPassword('password', DUMMY_PASSWORD_HASH)).valid).toBe(
      false,
    );
  });
});
