import {describe, expect, it} from 'bun:test';
import {ParticipantLoginInputSchema, StaffLoginInputSchema} from './auth';

describe('login input schemas', () => {
  // Passwords set before `PASSWORD_MAX_LENGTH` existed had no maximum, and a
  // login that refused them would lock their owners out.
  for (const [name, schema] of [
    ['StaffLoginInputSchema', StaffLoginInputSchema],
    ['ParticipantLoginInputSchema', ParticipantLoginInputSchema],
  ] as const) {
    it(`${name} accepts a password longer than a new one may be`, () => {
      expect(
        schema.safeParse({email: 'a@example.com', password: 'x'.repeat(300)})
          .success,
      ).toBe(true);
    });

    it(`${name} still bounds the password length`, () => {
      expect(
        schema.safeParse({email: 'a@example.com', password: 'x'.repeat(1025)})
          .success,
      ).toBe(false);
    });

    it(`${name} accepts a common password`, () => {
      expect(
        schema.safeParse({email: 'a@example.com', password: 'password123'})
          .success,
      ).toBe(true);
    });
  }
});
