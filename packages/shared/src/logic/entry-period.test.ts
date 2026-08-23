import {describe, expect, it} from 'bun:test';
import {isWithinEntryPeriod} from './entry-period';

describe('isWithinEntryPeriod', () => {
  const opensAt = '2026-08-01T00:00:00Z';
  const closesAt = '2026-08-31T00:00:00Z';

  it('returns true within the window', () => {
    expect(
      isWithinEntryPeriod(opensAt, closesAt, new Date('2026-08-15T00:00:00Z')),
    ).toBe(true);
  });

  it('returns true at the exact boundaries', () => {
    expect(isWithinEntryPeriod(opensAt, closesAt, new Date(opensAt))).toBe(
      true,
    );
    expect(isWithinEntryPeriod(opensAt, closesAt, new Date(closesAt))).toBe(
      true,
    );
  });

  it('returns false before opening', () => {
    expect(
      isWithinEntryPeriod(opensAt, closesAt, new Date('2026-07-31T23:59:59Z')),
    ).toBe(false);
  });

  it('returns false after closing', () => {
    expect(
      isWithinEntryPeriod(opensAt, closesAt, new Date('2026-08-31T00:00:01Z')),
    ).toBe(false);
  });
});
