import {describe, expect, it} from 'vitest';
import {pageQuery, readPageOffset} from './pagination';

describe('readPageOffset', () => {
  it('reads the offset from the query', () => {
    expect(readPageOffset(new URLSearchParams('offset=200'))).toBe(200);
  });

  it('falls back to the first page for a missing or invalid offset', () => {
    for (const query of ['', 'offset=-1', 'offset=1.5', 'offset=abc']) {
      expect(readPageOffset(new URLSearchParams(query))).toBe(0);
    }
  });
});

describe('pageQuery', () => {
  it('replaces the offset and keeps the other parameters', () => {
    expect(
      pageQuery(new URLSearchParams('status=waitlisted&offset=100'), 200),
    ).toBe('?status=waitlisted&offset=200');
  });

  it('drops the offset for the first page', () => {
    expect(pageQuery(new URLSearchParams('offset=100'), 0)).toBe('?');
    expect(
      pageQuery(new URLSearchParams('status=confirmed&offset=100'), 0),
    ).toBe('?status=confirmed');
  });
});
