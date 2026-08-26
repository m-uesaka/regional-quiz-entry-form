import {describe, expect, it} from 'bun:test';
import {calculateFillRate} from './fill-rate';

describe('calculateFillRate', () => {
  it('returns the confirmed share of the capacity', () => {
    expect(calculateFillRate(15, 20)).toBe(0.75);
  });

  it('returns 0 for a tournament nobody has entered', () => {
    expect(calculateFillRate(0, 20)).toBe(0);
  });

  it('returns null for an uncapped tournament', () => {
    expect(calculateFillRate(15, null)).toBeNull();
  });

  it('reports over-subscription rather than clamping to 1', () => {
    expect(calculateFillRate(12, 10)).toBeCloseTo(1.2);
  });
});
