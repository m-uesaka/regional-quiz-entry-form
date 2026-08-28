import {describe, expect, it} from 'bun:test';
import {StaffAccountCreateInputSchema} from './staff';

const REGION_ID = '11111111-1111-1111-1111-111111111111';

describe('StaffAccountCreateInputSchema', () => {
  it('accepts a general account with no scope', () => {
    const result = StaffAccountCreateInputSchema.safeParse({
      role: 'general',
      email: 'general@example.com',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a regional account carrying both a region and a type', () => {
    const result = StaffAccountCreateInputSchema.safeParse({
      role: 'regional',
      email: 'regional@example.com',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a regional account missing half of its scope', () => {
    for (const input of [
      {role: 'regional', email: 'a@example.com', regionId: REGION_ID},
      {role: 'regional', email: 'a@example.com', tournamentType: 'saikyoi'},
      {role: 'regional', email: 'a@example.com'},
    ]) {
      expect(StaffAccountCreateInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });

  it('drops a scope sent for a general account', () => {
    const result = StaffAccountCreateInputSchema.safeParse({
      role: 'general',
      email: 'general@example.com',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        role: 'general',
        email: 'general@example.com',
      });
    }
  });
});
