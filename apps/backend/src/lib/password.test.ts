import {describe, expect, it} from 'bun:test';
import {hashPassword, verifyPassword} from './password';

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
