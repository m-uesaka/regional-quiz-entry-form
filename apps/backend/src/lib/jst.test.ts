import {describe, expect, it} from 'bun:test';
import {formatJstDateTime} from './jst';

describe('formatJstDateTime', () => {
  it('writes an instant in Japan time, to the minute', () => {
    expect(formatJstDateTime('2026-10-01T03:04:59.999Z')).toBe(
      '2026-10-01 12:04',
    );
  });

  it('moves the date on past midnight in Japan', () => {
    expect(formatJstDateTime('2026-12-31T15:00:00+00:00')).toBe(
      '2027-01-01 00:00',
    );
  });

  it('passes a value it cannot read through unchanged', () => {
    expect(formatJstDateTime('not a time')).toBe('not a time');
  });
});
