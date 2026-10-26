import {describe, expect, it} from 'vitest';
import {isWaitlistOpen, priorityEntryNotices} from './priority-entry';

describe('priorityEntryNotices', () => {
  const now = new Date('2026-11-03T00:00:00Z');

  it('announces nothing when no window is open', () => {
    expect(
      priorityEntryNotices(
        [
          {label: '条件なし', priorityStartsAt: null, priorityEndsAt: null},
          {
            label: '在学',
            priorityStartsAt: '2026-11-10T00:00:00Z',
            priorityEndsAt: '2026-11-12T00:00:00Z',
          },
        ],
        now,
      ),
    ).toEqual([]);
  });

  // Each notice names the moment its regulations stop being prioritised,
  // so windows ending apart are not merged under either end.
  it('groups the open windows by when they end, earliest first', () => {
    expect(
      priorityEntryNotices(
        [
          {
            label: '在勤',
            priorityStartsAt: '2026-11-01T00:00:00Z',
            priorityEndsAt: '2026-11-08T00:00:00Z',
          },
          {
            label: '在住',
            priorityStartsAt: '2026-11-01T00:00:00Z',
            priorityEndsAt: '2026-11-05T00:00:00Z',
          },
          {
            label: '在学',
            priorityStartsAt: '2026-11-02T00:00:00Z',
            priorityEndsAt: '2026-11-08T00:00:00Z',
          },
        ],
        now,
      ),
    ).toEqual([
      {labels: ['在住'], endsAtLabel: '2026年11月5日(木) 9:00'},
      {labels: ['在勤', '在学'], endsAtLabel: '2026年11月8日(日) 9:00'},
    ]);
  });
});

describe('isWaitlistOpen', () => {
  it('is never open without a capacity', () => {
    expect(isWaitlistOpen(null, {confirmedCount: 99, waitlistedCount: 0})).toBe(
      false,
    );
  });

  it('opens once every seat is taken, or while anyone is waiting', () => {
    expect(isWaitlistOpen(10, {confirmedCount: 9, waitlistedCount: 0})).toBe(
      false,
    );
    expect(isWaitlistOpen(10, {confirmedCount: 10, waitlistedCount: 0})).toBe(
      true,
    );
    expect(isWaitlistOpen(10, {confirmedCount: 9, waitlistedCount: 1})).toBe(
      true,
    );
  });
});
