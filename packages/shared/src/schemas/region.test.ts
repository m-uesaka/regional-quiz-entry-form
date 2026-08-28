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
});
