import {RegionCreateInputSchema} from '@regional-quiz/shared';
import {describe, expect, it} from 'vitest';
import {zodFieldErrors} from './zod-field-errors';

describe('zodFieldErrors', () => {
  it("keys the schema's messages by the field each one is about", () => {
    const parsed = RegionCreateInputSchema.safeParse({
      slug: 'Not A Slug',
      name: '',
    });
    if (parsed.success) {
      throw new Error('expected the input to be refused');
    }

    const fieldErrors = zodFieldErrors(parsed.error);

    expect(fieldErrors).toEqual(parsed.error.flatten().fieldErrors);
    expect(Object.keys(fieldErrors).sort()).toEqual(['name', 'slug']);
    expect(fieldErrors.slug?.length).toBeGreaterThan(0);
  });

  it('leaves out fields that were accepted', () => {
    const parsed = RegionCreateInputSchema.safeParse({
      slug: 'tokyo',
      name: '',
    });
    if (parsed.success) {
      throw new Error('expected the input to be refused');
    }

    expect(zodFieldErrors(parsed.error).slug).toBeUndefined();
  });
});
