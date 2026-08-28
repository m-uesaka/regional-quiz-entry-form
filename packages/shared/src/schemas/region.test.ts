import {describe, expect, it} from 'bun:test';
import {
  RegionCreateInputSchema,
  RegionSlugSchema,
  RegionUpdateInputSchema,
} from './region';

describe('RegionSlugSchema', () => {
  it('accepts a lowercase hyphenated slug', () => {
    expect(RegionSlugSchema.safeParse('kanto-2026').success).toBe(true);
  });

  it('rejects uppercase, leading digits and path separators', () => {
    for (const slug of [
      'Kanto',
      '2026-kanto',
      'kanto/2026',
      'kanto?a=1',
      'kanto 2026',
      '関東',
      'k',
      'a'.repeat(32),
    ]) {
      expect(RegionSlugSchema.safeParse(slug).success).toBe(false);
    }
  });

  it('names the length rule in the rejection message', () => {
    const result = RegionSlugSchema.safeParse('a'.repeat(32));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('2〜31 文字');
    }
  });
});

describe('RegionCreateInputSchema', () => {
  it('requires both a slug and a name', () => {
    expect(RegionCreateInputSchema.safeParse({slug: 'kanto'}).success).toBe(
      false,
    );
    expect(
      RegionCreateInputSchema.safeParse({slug: 'kanto', name: '関東'}).success,
    ).toBe(true);
  });

  it('defaults allowsDualEntry to false', () => {
    const result = RegionCreateInputSchema.safeParse({
      slug: 'kanto',
      name: '関東',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowsDualEntry).toBe(false);
    }
  });

  it('keeps an explicit allowsDualEntry', () => {
    const result = RegionCreateInputSchema.safeParse({
      slug: 'kanto',
      name: '関東',
      allowsDualEntry: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowsDualEntry).toBe(true);
    }
  });
});

describe('RegionUpdateInputSchema', () => {
  it('does not accept a slug', () => {
    const result = RegionUpdateInputSchema.safeParse({
      name: '関東',
      slug: 'kanto',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({name: '関東'});
    }
  });

  // Absent rather than defaulted, so `routes/regions.ts` can tell "leave it
  // alone" apart from "set it to false".
  it('leaves allowsDualEntry out when it was not sent', () => {
    const result = RegionUpdateInputSchema.safeParse({name: '関東'});

    expect(result.success).toBe(true);
    if (result.success) {
      expect('allowsDualEntry' in result.data).toBe(false);
    }
  });

  it('accepts allowsDualEntry', () => {
    const result = RegionUpdateInputSchema.safeParse({
      name: '関東',
      allowsDualEntry: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowsDualEntry).toBe(true);
    }
  });

  // Flipping the setting alone must not have to resend `name`: a `name`
  // read before another staff member renamed the region would be written
  // back on top of the rename.
  it('accepts allowsDualEntry without a name', () => {
    const result = RegionUpdateInputSchema.safeParse({allowsDualEntry: true});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({allowsDualEntry: true});
    }
  });

  it('rejects a body with nothing to update', () => {
    expect(RegionUpdateInputSchema.safeParse({}).success).toBe(false);
    // `slug` is stripped, so a body that only carries one updates nothing.
    expect(
      RegionUpdateInputSchema.safeParse({slug: 'kanto'}).success,
    ).toBe(false);
  });
});
