import {describe, expect, it} from 'bun:test';
import {
  activePriorityRegulations,
  isRegulationSelectionAllowed,
  selectableRegulations,
} from './regulation-eligibility';

// Closes later than every window below, so none of them runs to the close
// unless a test says so.
const ENTRY_PERIOD = {
  entryOpensAt: '2026-01-01T00:00:00Z',
  entryClosesAt: '2026-12-31T00:00:00Z',
};

describe('isRegulationSelectionAllowed', () => {
  it('rejects an empty selection', () => {
    const regulations = [
      {id: 'reg-1', priorityStartsAt: null, priorityEndsAt: null},
      {id: 'reg-2', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        [],
        new Date('2026-08-23T00:00:00Z'),
        ENTRY_PERIOD,
      ),
    ).toBe(false);
  });

  it('accepts any selection when no priority window is active', () => {
    const regulations = [
      {id: 'reg-1', priorityStartsAt: null, priorityEndsAt: null},
      {id: 'reg-2', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        ['reg-1', 'reg-2'],
        new Date('2026-08-23T00:00:00Z'),
        ENTRY_PERIOD,
      ),
    ).toBe(true);
  });

  it('accepts a selection containing one active priority regulation', () => {
    const regulations = [
      {
        id: 'priority-reg',
        priorityStartsAt: '2026-08-01T00:00:00Z',
        priorityEndsAt: '2026-08-31T00:00:00Z',
      },
      {id: 'other-reg', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        ['other-reg', 'priority-reg'],
        new Date('2026-08-15T00:00:00Z'),
        ENTRY_PERIOD,
      ),
    ).toBe(true);
  });

  it('rejects a selection of only non-priority regulations during a window', () => {
    const regulations = [
      {
        id: 'priority-reg',
        priorityStartsAt: '2026-08-01T00:00:00Z',
        priorityEndsAt: '2026-08-31T00:00:00Z',
      },
      {id: 'other-reg', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        ['other-reg'],
        new Date('2026-08-15T00:00:00Z'),
        ENTRY_PERIOD,
      ),
    ).toBe(false);
  });

  it('opens up after the priority window ends', () => {
    const regulations = [
      {
        id: 'priority-reg',
        priorityStartsAt: '2026-08-01T00:00:00Z',
        priorityEndsAt: '2026-08-31T00:00:00Z',
      },
      {id: 'other-reg', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        ['other-reg'],
        new Date('2026-09-01T00:00:00Z'),
        ENTRY_PERIOD,
      ),
    ).toBe(true);
  });

  it('rejects a selection containing an unknown regulation id', () => {
    const regulations = [
      {id: 'reg-1', priorityStartsAt: null, priorityEndsAt: null},
      {id: 'reg-2', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        ['reg-1', 'unknown-reg'],
        new Date('2026-08-23T00:00:00Z'),
        ENTRY_PERIOD,
      ),
    ).toBe(false);
  });
});

describe('activePriorityRegulations', () => {
  const regulations = [
    {
      id: 'none',
      label: '条件なし',
      priorityStartsAt: null,
      priorityEndsAt: null,
    },
    {
      id: 'open',
      label: '在住',
      priorityStartsAt: '2026-11-01T00:00:00Z',
      priorityEndsAt: '2026-11-05T00:00:00Z',
    },
    {
      id: 'later',
      label: '在学',
      priorityStartsAt: '2026-11-10T00:00:00Z',
      priorityEndsAt: '2026-11-12T00:00:00Z',
    },
  ];

  it('lists only the windows open at that moment, keeping their fields', () => {
    const active = activePriorityRegulations(
      regulations,
      new Date('2026-11-03T00:00:00Z'),
      ENTRY_PERIOD,
    );

    expect(active.map(r => [r.id, r.label])).toEqual([['open', '在住']]);
  });

  it('counts both ends of a window as inside it', () => {
    const ids = (now: string) =>
      activePriorityRegulations(regulations, new Date(now), ENTRY_PERIOD).map(
        r => r.id,
      );

    expect(ids('2026-11-01T00:00:00Z')).toEqual(['open']);
    expect(ids('2026-11-05T00:00:00Z')).toEqual(['open']);
    expect(ids('2026-11-05T00:00:01Z')).toEqual([]);
  });

  // #235: 東東京 gives its general regulation a window from the end of the
  // priority one to the close, which is how a tournament is phased.
  describe('in the general phase', () => {
    const closesAt = '2026-12-25T12:00:00Z';
    const period = {
      entryOpensAt: '2026-10-29T12:00:00Z',
      entryClosesAt: closesAt,
    };
    const priority = {
      id: 'priority',
      priorityStartsAt: '2026-10-29T12:00:00Z',
      priorityEndsAt: '2026-10-31T12:00:00Z',
    };
    const general = {
      id: 'general',
      priorityStartsAt: '2026-10-31T12:00:00Z',
      priorityEndsAt: closesAt,
    };
    const unlimited = {id: 'tag', priorityStartsAt: null, priorityEndsAt: null};
    const listed = (
      regulations: ReadonlyArray<typeof priority | typeof unlimited>,
      now: string,
      entryPeriod = period,
    ) =>
      activePriorityRegulations(regulations, new Date(now), entryPeriod).map(
        r => r.id,
      );

    const selectable = (
      regulations: ReadonlyArray<typeof priority | typeof unlimited>,
      now: string,
    ) =>
      selectableRegulations(regulations, new Date(now), period).map(r => r.id);

    it('lists nothing and accepts what is still on offer', () => {
      const now = new Date('2026-10-31T12:00:01Z');
      const regulations = [priority, general, unlimited];

      expect(listed(regulations, now.toISOString())).toEqual([]);
      expect(
        isRegulationSelectionAllowed(regulations, ['general'], now, period),
      ).toBe(true);
      expect(
        isRegulationSelectionAllowed(regulations, ['tag'], now, period),
      ).toBe(true);
    });

    it('takes the phase that is over off the offer', () => {
      const now = new Date('2026-10-31T12:00:01Z');
      const regulations = [priority, general];

      expect(selectable(regulations, now.toISOString())).toEqual(['general']);
      expect(
        isRegulationSelectionAllowed(regulations, ['priority'], now, period),
      ).toBe(false);
      expect(
        isRegulationSelectionAllowed(
          regulations,
          ['priority', 'general'],
          now,
          period,
        ),
      ).toBe(false);
    });

    it('keeps everything on offer until the general phase starts', () => {
      const later = {...general, priorityStartsAt: '2026-11-01T00:00:00Z'};

      expect(selectable([priority, later], '2026-10-31T18:00:00Z')).toEqual([
        'priority',
        'general',
      ]);
    });

    // 中四国 and 東北: residents stay eligible after their priority, and a
    // window may sit on the only regulation.
    it('keeps a regulation whose window ended outside the general phase', () => {
      expect(selectable([priority, unlimited], '2026-11-01T00:00:00Z')).toEqual(
        ['priority', 'tag'],
      );
      expect(selectable([priority], '2026-11-01T00:00:00Z')).toEqual([
        'priority',
      ]);
    });

    it('keeps a regulation whose window ended before entries opened', () => {
      const stale = {
        id: 'stale',
        priorityStartsAt: '2026-09-01T00:00:00Z',
        priorityEndsAt: '2026-09-10T00:00:00Z',
      };

      expect(
        selectable([stale, priority, general], '2026-11-01T00:00:00Z'),
      ).toEqual(['stale', 'general']);
    });

    it('allows a gap between the phases', () => {
      const later = {...general, priorityStartsAt: '2026-11-01T00:00:00Z'};

      expect(listed([priority, later], '2026-11-02T00:00:00Z')).toEqual([]);
    });

    it('still gates the entries while the priority window is open', () => {
      const now = new Date('2026-10-30T00:00:00Z');

      expect(listed([priority, general], now.toISOString())).toEqual([
        'priority',
      ]);
      expect(
        isRegulationSelectionAllowed(
          [priority, general],
          ['general'],
          now,
          period,
        ),
      ).toBe(false);
    });

    it('waits for a later phase to be over', () => {
      const third = {
        id: 'third',
        priorityStartsAt: '2026-11-15T00:00:00Z',
        priorityEndsAt: closesAt,
      };
      const regulations = [priority, general, third];
      const now = new Date('2026-11-01T00:00:00Z');

      expect(listed(regulations, now.toISOString())).toEqual(['general']);
      expect(
        isRegulationSelectionAllowed(regulations, ['third'], now, period),
      ).toBe(false);
    });

    it('never lifts and restores the check around a shorter window', () => {
      const shorter = {
        id: 'shorter',
        priorityStartsAt: '2026-11-15T00:00:00Z',
        priorityEndsAt: '2026-11-20T00:00:00Z',
      };
      const regulations = [priority, general, shorter];

      expect(listed(regulations, '2026-11-01T00:00:00Z')).toEqual(['general']);
      expect(listed(regulations, '2026-11-16T00:00:00Z')).toEqual([
        'general',
        'shorter',
      ]);
    });

    it('keeps a window that overlapped the one that ended', () => {
      const whole = {...general, priorityStartsAt: priority.priorityStartsAt};
      const regulations = [priority, whole, unlimited];
      const now = new Date('2026-11-01T00:00:00Z');

      expect(listed(regulations, '2026-10-30T00:00:00Z')).toEqual([
        'priority',
        'general',
      ]);
      expect(listed(regulations, now.toISOString())).toEqual(['general']);
      expect(
        isRegulationSelectionAllowed(regulations, ['tag'], now, period),
      ).toBe(false);
    });

    it('ignores a window that ended before entries opened', () => {
      const stale = {
        id: 'stale',
        priorityStartsAt: '2026-09-01T00:00:00Z',
        priorityEndsAt: '2026-09-10T00:00:00Z',
      };
      const whole = {...general, priorityStartsAt: period.entryOpensAt};
      const regulations = [stale, whole, unlimited];
      const now = new Date('2026-11-01T00:00:00Z');

      expect(listed(regulations, now.toISOString())).toEqual(['general']);
      expect(
        isRegulationSelectionAllowed(regulations, ['tag'], now, period),
      ).toBe(false);
    });

    it('still gates on a window with none ended before it', () => {
      expect(listed([general, unlimited], '2026-11-01T00:00:00Z')).toEqual([
        'general',
      ]);
    });

    it.each([
      ['23:59 for 23:59:59', '2026-12-25T14:59:00Z', '2026-12-25T14:59:59Z'],
      ['23:59:59 for 0:00', '2026-12-25T14:59:59Z', '2026-12-25T15:00:00Z'],
      ['23:59 for 0:00', '2026-12-25T14:59:00Z', '2026-12-25T15:00:00Z'],
    ])('counts %s as the close', (_, endsAt, entryClosesAt) => {
      expect(
        listed(
          [priority, {...general, priorityEndsAt: endsAt}],
          '2026-11-01T00:00:00Z',
          {...period, entryClosesAt},
        ),
      ).toEqual([]);
    });

    it('leaves a window ending earlier than that as priority', () => {
      const earlier = {...general, priorityEndsAt: '2026-12-19T12:00:00Z'};

      expect(listed([priority, earlier], '2026-11-01T00:00:00Z')).toEqual([
        'general',
      ]);
    });
  });
});
