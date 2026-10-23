import {describe, expect, it, spyOn} from 'bun:test';
import type {Bindings} from '../types/env';
import {hashPassword, UNUSABLE_PASSWORD_HASH} from './password';
import {verifyAccountPassword} from './password-rehash';

// No Supabase to reach: the one test that schedules an upgrade only checks
// that it was handed over, and silences the failure the write logs.
const ENV = {} as Bindings;

const LEGACY_SALT = '00'.repeat(16);

/** A hash in the pre-`$` `salt:hash` format, which always needs a rehash. */
async function legacyHash(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: Uint8Array.from(Buffer.from(LEGACY_SALT, 'hex')),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return `${LEGACY_SALT}:${Buffer.from(bits).toString('hex')}`;
}

describe('verifyAccountPassword', () => {
  it('accepts the right password and schedules nothing for a current hash', async () => {
    const deferred: Array<Promise<void>> = [];
    const account = {id: 'a1', password_hash: await hashPassword('right one')};

    expect(
      await verifyAccountPassword(
        ENV,
        'participants',
        account,
        'right one',
        upgrade => {
          deferred.push(upgrade);
        },
      ),
    ).toBe(true);
    expect(deferred).toHaveLength(0);
  });

  it('refuses a wrong password', async () => {
    const account = {id: 'a1', password_hash: await hashPassword('right one')};

    expect(
      await verifyAccountPassword(
        ENV,
        'participants',
        account,
        'wrong one',
        () => {},
      ),
    ).toBe(false);
  });

  it('hands the upgrade of an older hash to the caller', async () => {
    const deferred: Array<Promise<void>> = [];
    const account = {id: 'a1', password_hash: await legacyHash('right one')};
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(
        await verifyAccountPassword(
          ENV,
          'participants',
          account,
          'right one',
          upgrade => {
            deferred.push(upgrade);
          },
        ),
      ).toBe(true);
      expect(deferred).toHaveLength(1);
      // `rehashPassword()` never rejects, even with nowhere to write to.
      await expect(deferred[0]).resolves.toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });

  // An address with no account and one whose hash can never match must cost
  // the same PBKDF2 work as a wrong password, or the response time tells an
  // attacker the address is registered.
  for (const [label, account] of [
    ['no account', null],
    ['an unusable hash', {id: 'a1', password_hash: UNUSABLE_PASSWORD_HASH}],
    ['a corrupted hash', {id: 'a1', password_hash: 'pbkdf2-sha256$1$x$y'}],
  ] as const) {
    it(`still derives a key for ${label}`, async () => {
      const deriveSpy = spyOn(crypto.subtle, 'deriveBits');
      try {
        expect(
          await verifyAccountPassword(
            ENV,
            'participants',
            account,
            'any password',
            () => {},
          ),
        ).toBe(false);
        expect(deriveSpy).toHaveBeenCalledTimes(1);
      } finally {
        deriveSpy.mockRestore();
      }
    });
  }
});
