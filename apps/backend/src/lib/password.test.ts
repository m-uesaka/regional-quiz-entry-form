import {describe, expect, it} from 'bun:test';
import {
  hashPassword,
  isPasswordHashUsable,
  UNUSABLE_PASSWORD_HASH,
  verifyPassword,
} from './password';

describe('hashPassword / verifyPassword', () => {
  it('verifies a matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('correct horse battery staple', hash)).toBe(
      true,
    );
  });

  it('rejects a non-matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('rejects a malformed stored hash', async () => {
    expect(await verifyPassword('anything', 'not-a-valid-stored-hash')).toBe(
      false,
    );
  });

  it('salts each hash differently for the same password', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');

    expect(a).not.toBe(b);
  });
});

describe('isPasswordHashUsable', () => {
  it('accepts a hash this module produced', async () => {
    expect(isPasswordHashUsable(await hashPassword('a password'))).toBe(true);
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
    ]) {
      expect(isPasswordHashUsable(stored)).toBe(false);
    }
  });
});
