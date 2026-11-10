import {describe, expect, it} from 'bun:test';
import {describeSheetDatetime, parseSheetDatetime} from './sheet-datetime';

const LOOSE = {requireTime: false};
const STRICT = {requireTime: true};

describe('parseSheetDatetime', () => {
  it('reads a serial as Japan time', () => {
    expect(parseSheetDatetime(46235 + 10 / 24, LOOSE)).toBe(
      '2026-08-01T01:00:00.000Z',
    );
    expect(parseSheetDatetime(46235 + 10 / 24, STRICT)).toBe(
      '2026-08-01T01:00:00.000Z',
    );
  });

  it('reads text in either separator style', () => {
    for (const text of [
      '2026-08-01 10:00',
      '2026/8/1 10:00:00',
      '2026-08-01T10:00',
      ' 2026/08/01  10:00 ',
    ]) {
      expect(parseSheetDatetime(text, STRICT)).toBe('2026-08-01T01:00:00.000Z');
    }
  });

  it('reads a bare date as midnight only when the time is optional', () => {
    expect(parseSheetDatetime('2026-08-01', LOOSE)).toBe(
      '2026-07-31T15:00:00.000Z',
    );
    expect(parseSheetDatetime('2026-08-01', STRICT)).toBeNull();
  });

  it('refuses what is not a date-time', () => {
    for (const cell of [
      '',
      '調整中',
      '2026-02-30 10:00',
      '2026-08-01 24:00',
      '2026-08-01 10:60',
      2026,
      NaN,
      true,
      undefined,
    ]) {
      expect(parseSheetDatetime(cell, LOOSE)).toBeNull();
    }
  });
});

describe('describeSheetDatetime', () => {
  it('writes a serial as Japan time and leaves text as typed', () => {
    expect(describeSheetDatetime(46330.875)).toBe('2026-11-04 21:00');
    expect(describeSheetDatetime(' 調整中 ')).toBe('調整中');
    expect(describeSheetDatetime(undefined)).toBe('');
    expect(describeSheetDatetime(12)).toBe('12');
  });
});
