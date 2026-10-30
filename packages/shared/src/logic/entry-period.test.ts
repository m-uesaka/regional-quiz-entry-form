import {describe, expect, it} from 'bun:test';
import {isAcceptingEntries, isWithinEntryPeriod} from './entry-period';

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

describe('isAcceptingEntries', () => {
  const tournament = {
    entryOpensAt: '2026-11-01T00:00:00Z',
    entryClosesAt: '2026-11-30T00:00:00Z',
    entriesPaused: false,
  };
  const within = new Date('2026-11-15T00:00:00Z');

  it('accepts entries within the period when not paused', () => {
    expect(isAcceptingEntries(tournament, within)).toBe(true);
  });

  it('accepts none while paused, even within the period', () => {
    expect(
      isAcceptingEntries({...tournament, entriesPaused: true}, within),
    ).toBe(false);
  });

  it('accepts none outside the period', () => {
    expect(
      isAcceptingEntries(tournament, new Date('2026-12-01T00:00:00Z')),
    ).toBe(false);
  });
});
