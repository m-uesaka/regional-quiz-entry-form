import {describe, expect, it} from 'vitest';
import {fromJstDatetimeLocal, toJstDatetimeLocal} from './jst-datetime';

describe('toJstDatetimeLocal', () => {
  it('shows a stored instant as its JST wall-clock time', () => {
    expect(toJstDatetimeLocal('2026-01-01T00:00:00.000Z')).toBe(
      '2026-01-01T09:00',
    );
  });

  it('carries a date across the day boundary', () => {
    expect(toJstDatetimeLocal('2026-01-01T16:30:00.000Z')).toBe(
      '2026-01-02T01:30',
    );
  });

  it('answers with an empty value when there is nothing to show', () => {
    expect(toJstDatetimeLocal(null)).toBe('');
    expect(toJstDatetimeLocal('not a date')).toBe('');
  });
});

describe('fromJstDatetimeLocal', () => {
  it('reads a submitted wall-clock time as JST', () => {
    expect(fromJstDatetimeLocal('2026-01-01T09:00')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('accepts a value that carries seconds', () => {
    expect(fromJstDatetimeLocal('2026-01-01T09:00:30')).toBe(
      '2026-01-01T00:00:30.000Z',
    );
  });

  it('round-trips the value it rendered', () => {
    const iso = '2026-03-04T12:34:00.000Z';
    expect(fromJstDatetimeLocal(toJstDatetimeLocal(iso))).toBe(iso);
  });

  it('reports an empty control as no instant at all', () => {
    expect(fromJstDatetimeLocal('')).toBeNull();
    expect(fromJstDatetimeLocal('   ')).toBeNull();
  });

  it('hands back a value that is not a datetime so the schema can reject it', () => {
    expect(fromJstDatetimeLocal('明日')).toBe('明日');
  });
});
