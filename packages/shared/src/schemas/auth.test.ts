import {describe, expect, it} from 'bun:test';
import {
  ParticipantLoginInputSchema,
  PasswordResetRequestInputSchema,
  StaffLoginInputSchema,
} from './auth';

describe('login input schemas', () => {
  // Passwords set before `PASSWORD_MAX_LENGTH` existed had no maximum, and a
  // login that refused them would lock their owners out.
  for (const [name, schema, extra] of [
    ['StaffLoginInputSchema', StaffLoginInputSchema, {scope: 'saikyoi'}],
    ['ParticipantLoginInputSchema', ParticipantLoginInputSchema, {}],
  ] as const) {
    it(`${name} accepts a password longer than a new one may be`, () => {
      expect(
        schema.safeParse({
          ...extra,
          email: 'a@example.com',
          password: 'x'.repeat(300),
        }).success,
      ).toBe(true);
    });

    it(`${name} still bounds the password length`, () => {
      expect(
        schema.safeParse({
          ...extra,
          email: 'a@example.com',
          password: 'x'.repeat(1025),
        }).success,
      ).toBe(false);
    });

    it(`${name} accepts a common password`, () => {
      expect(
        schema.safeParse({
          ...extra,
          email: 'a@example.com',
          password: 'password123',
        }).success,
      ).toBe(true);
    });

    // #133: one mailbox, one account, whichever way the address is typed.
    it(`${name} lowercases the address`, () => {
      const parsed = schema.parse({
        ...extra,
        email: 'Foo@Example.COM',
        password: 'password123',
      });
      expect(parsed.email).toBe('foo@example.com');
    });
  }

  it('PasswordResetRequestInputSchema lowercases the address', () => {
    expect(
      PasswordResetRequestInputSchema.parse({email: 'Foo@Example.com'}).email,
    ).toBe('foo@example.com');
  });

  // #166: the address alone no longer names one staff account.
  it('StaffLoginInputSchema requires the scope', () => {
    expect(
      StaffLoginInputSchema.safeParse({
        email: 'a@example.com',
        password: 'password123',
      }).success,
    ).toBe(false);
  });

  it('StaffLoginInputSchema accepts each scope and nothing else', () => {
    for (const scope of ['saikyoi', 'shinjinou', 'general']) {
      expect(
        StaffLoginInputSchema.safeParse({
          email: 'a@example.com',
          scope,
          password: 'password123',
        }).success,
      ).toBe(true);
    }
    expect(
      StaffLoginInputSchema.safeParse({
        email: 'a@example.com',
        scope: 'regional',
        password: 'password123',
      }).success,
    ).toBe(false);
  });
});
