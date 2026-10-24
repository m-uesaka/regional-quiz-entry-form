import {describe, expect, it} from 'bun:test';
import {z} from 'zod';
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PageQuerySchema,
  PageSchema,
  StaffEntryListQuerySchema,
} from './pagination';

describe('PageQuerySchema', () => {
  it('defaults to the first page of the default size', () => {
    expect(PageQuerySchema.parse({})).toEqual({
      limit: PAGE_SIZE_DEFAULT,
      offset: 0,
    });
  });

  it('coerces query-string values', () => {
    expect(PageQuerySchema.parse({limit: '20', offset: '40'})).toEqual({
      limit: 20,
      offset: 40,
    });
  });

  it('rejects a limit over the maximum, a zero limit and a negative offset', () => {
    for (const query of [
      {limit: String(PAGE_SIZE_MAX + 1)},
      {limit: '0'},
      {offset: '-1'},
      {limit: '1.5'},
      {offset: 'abc'},
    ]) {
      expect(PageQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe('StaffEntryListQuerySchema', () => {
  it('accepts an entry status and rejects anything else', () => {
    expect(StaffEntryListQuerySchema.parse({status: 'waitlisted'})).toEqual({
      limit: PAGE_SIZE_DEFAULT,
      offset: 0,
      status: 'waitlisted',
    });
    expect(StaffEntryListQuerySchema.safeParse({status: 'nope'}).success).toBe(
      false,
    );
  });
});

describe('PageSchema', () => {
  it('wraps the item schema with the paging fields', () => {
    const schema = PageSchema(z.string());

    expect(schema.parse({items: ['a'], total: 3, limit: 1, offset: 0})).toEqual(
      {items: ['a'], total: 3, limit: 1, offset: 0},
    );
    expect(
      schema.safeParse({items: [1], total: 3, limit: 1, offset: 0}).success,
    ).toBe(false);
  });
});
