import {describe, expect, it} from 'bun:test';
import {formatLinkLifetime} from './link-lifetime';

describe('formatLinkLifetime', () => {
  it('states a whole number of hours in hours', () => {
    expect(formatLinkLifetime(24 * 60 * 60 * 1000)).toBe('24時間');
  });

  it('falls back to minutes, rounded down, for a lifetime of part hours', () => {
    expect(formatLinkLifetime(90 * 60 * 1000)).toBe('90分');
    expect(formatLinkLifetime(90 * 60 * 1000 + 30 * 1000)).toBe('90分');
    expect(formatLinkLifetime(30 * 60 * 1000)).toBe('30分');
  });
});
