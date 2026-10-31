import {describe, expect, it} from 'vitest';
import {isWaitlistOpen, priorityEntryNotices} from './priority-entry';

// Later than every window below, so none of them runs to the close unless a
// test says so.
const ENTRY_CLOSES_AT = '2026-12-31T00:00:00Z';

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
        ENTRY_CLOSES_AT,
      ),
    ).toEqual([]);
  });

  // #235: the general regulation's window after the priority one has ended.
  it('announces nothing once only a window running to the close is open', () => {
    expect(
      priorityEntryNotices(
        [
          {
            label: '優先参加枠',
            priorityStartsAt: '2026-10-29T12:00:00Z',
            priorityEndsAt: '2026-11-01T12:00:00Z',
          },
          {
            label: '一般',
            priorityStartsAt: '2026-11-01T12:00:00Z',
            priorityEndsAt: ENTRY_CLOSES_AT,
          },
        ],
        now,
        ENTRY_CLOSES_AT,
      ),
    ).toEqual([]);
  });

  // Each notice names the window its regulations are prioritised over, so
  // windows that start or end apart are not merged under either.
  it('groups the open windows by when they start and end, earliest end first', () => {
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
        ENTRY_CLOSES_AT,
      ),
    ).toEqual([
      {
        labels: ['在住'],
        startsAtLabel: '2026年11月1日(日) 9:00',
        endsAtLabel: '2026年11月5日(木) 9:00',
      },
      {
        labels: ['在勤'],
        startsAtLabel: '2026年11月1日(日) 9:00',
        endsAtLabel: '2026年11月8日(日) 9:00',
      },
      {
        labels: ['在学'],
        startsAtLabel: '2026年11月2日(月) 9:00',
        endsAtLabel: '2026年11月8日(日) 9:00',
      },
    ]);
  });

  it('announces windows that start and end together as one', () => {
    expect(
      priorityEntryNotices(
        [
          {
            label: '在勤',
            priorityStartsAt: '2026-11-01T00:00:00Z',
            priorityEndsAt: '2026-11-08T00:00:00Z',
          },
          {
            label: '在学',
            priorityStartsAt: '2026-11-01T00:00:00Z',
            priorityEndsAt: '2026-11-08T00:00:00Z',
          },
        ],
        now,
        ENTRY_CLOSES_AT,
      ),
    ).toEqual([
      {
        labels: ['在勤', '在学'],
        startsAtLabel: '2026年11月1日(日) 9:00',
        endsAtLabel: '2026年11月8日(日) 9:00',
      },
    ]);
  });
});

describe('priorityEntryNotices, moments the page cannot tell apart', () => {
  const now = new Date('2026-11-03T00:00:00Z');

  it('announces windows starting and ending in the same printed minute together', () => {
    expect(
      priorityEntryNotices(
        [
          {
            label: '在住',
            priorityStartsAt: '2026-11-01T00:00:00Z',
            priorityEndsAt: '2026-11-05T00:00:00Z',
          },
          {
            label: '在学',
            priorityStartsAt: '2026-11-01T00:00:45Z',
            priorityEndsAt: '2026-11-05T00:00:30Z',
          },
          {
            label: '在勤',
            priorityStartsAt: '2026-11-01T09:00:00+09:00',
            priorityEndsAt: '2026-11-05T09:00:00+09:00',
          },
        ],
        now,
        ENTRY_CLOSES_AT,
      ),
    ).toEqual([
      {
        // In display order: the seconds the page doesn't print don't
        // reorder them.
        labels: ['在住', '在学', '在勤'],
        startsAtLabel: '2026年11月1日(日) 9:00',
        endsAtLabel: '2026年11月5日(木) 9:00',
      },
    ]);
  });

  it('orders by start when the ends print as the same minute', () => {
    expect(
      priorityEntryNotices(
        [
          {
            label: '在住',
            priorityStartsAt: '2026-11-02T00:00:00Z',
            priorityEndsAt: '2026-11-05T00:00:00Z',
          },
          {
            label: '在学',
            priorityStartsAt: '2026-11-01T00:00:00Z',
            priorityEndsAt: '2026-11-05T00:00:30Z',
          },
        ],
        now,
        ENTRY_CLOSES_AT,
      ),
    ).toEqual([
      {
        labels: ['在学'],
        startsAtLabel: '2026年11月1日(日) 9:00',
        endsAtLabel: '2026年11月5日(木) 9:00',
      },
      {
        labels: ['在住'],
        startsAtLabel: '2026年11月2日(月) 9:00',
        endsAtLabel: '2026年11月5日(木) 9:00',
      },
    ]);
  });
});

describe('isWaitlistOpen', () => {
  it('is never open without a capacity', () => {
    expect(isWaitlistOpen(null, {confirmedCount: 99, waitlistedCount: 0})).toBe(
      false,
    );
  });

  it('opens once every seat is taken', () => {
    expect(isWaitlistOpen(10, {confirmedCount: 9, waitlistedCount: 0})).toBe(
      false,
    );
    expect(isWaitlistOpen(10, {confirmedCount: 10, waitlistedCount: 0})).toBe(
      true,
    );
  });

  // As `confirm_entry_by_token()` decides it: after the capacity is raised,
  // entries can still be waiting while a new one would get a free seat.
  it('stays shut while seats are free, even with entries waiting', () => {
    expect(isWaitlistOpen(10, {confirmedCount: 9, waitlistedCount: 3})).toBe(
      false,
    );
  });
});
