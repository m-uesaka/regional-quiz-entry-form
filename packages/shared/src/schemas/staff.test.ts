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

  // The admin screen shows these beside the control they belong to, on an
  // otherwise all-Japanese page — and the region select cannot be marked
  // `required` instead, because the same form invites `general` staff.
  it('names the region and the address in Japanese when they are refused', () => {
    const result = StaffAccountCreateInputSchema.safeParse({
      role: 'regional',
      email: 'not-an-address',
      // What the select submits while nothing has been picked.
      regionId: '',
      tournamentType: 'saikyoi',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.regionId).toEqual(['担当地域を選択してください']);
      expect(fieldErrors.email).toEqual([
        'メールアドレスの形式が正しくありません',
      ]);
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
