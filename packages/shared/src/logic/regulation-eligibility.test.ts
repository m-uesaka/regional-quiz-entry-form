import {describe, expect, it} from 'bun:test';
import {
  activePriorityRegulations,
  isRegulationSelectionAllowed,
} from './regulation-eligibility';

// Later than every window below, so none of them runs to the close unless a
// test says so.
const ENTRY_CLOSES_AT = '2026-12-31T00:00:00Z';

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
        ENTRY_CLOSES_AT,
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
        ENTRY_CLOSES_AT,
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
        ENTRY_CLOSES_AT,
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
        ENTRY_CLOSES_AT,
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
        ENTRY_CLOSES_AT,
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
        ENTRY_CLOSES_AT,
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
      ENTRY_CLOSES_AT,
    );

    expect(active.map(r => [r.id, r.label])).toEqual([['open', '在住']]);
  });

  it('counts both ends of a window as inside it', () => {
    const ids = (now: string) =>
      activePriorityRegulations(
        regulations,
        new Date(now),
        ENTRY_CLOSES_AT,
      ).map(r => r.id);

    expect(ids('2026-11-01T00:00:00Z')).toEqual(['open']);
    expect(ids('2026-11-05T00:00:00Z')).toEqual(['open']);
    expect(ids('2026-11-05T00:00:01Z')).toEqual([]);
  });

  // #235: 東東京 gives its general regulation a window from the end of the
  // priority one to the close, which is how a tournament is phased.
  describe('once only a window running to the close is open', () => {
    const closesAt = '2026-12-25T12:00:00Z';
    const phased = [
      {
        id: 'priority',
        priorityStartsAt: '2026-10-29T12:00:00Z',
        priorityEndsAt: '2026-10-31T12:00:00Z',
      },
      {
        id: 'general',
        priorityStartsAt: '2026-10-31T12:00:00Z',
        priorityEndsAt: closesAt,
      },
    ];

    it('treats it as normal entry, listing nothing', () => {
      const now = new Date('2026-10-31T12:00:01Z');

      expect(activePriorityRegulations(phased, now, closesAt)).toEqual([]);
      expect(
        isRegulationSelectionAllowed(phased, ['priority'], now, closesAt),
      ).toBe(true);
    });

    it('still gates the entries while the priority window is open', () => {
      const now = new Date('2026-10-30T00:00:00Z');

      expect(
        activePriorityRegulations(phased, now, closesAt).map(r => r.id),
      ).toEqual(['priority']);
      expect(
        isRegulationSelectionAllowed(phased, ['general'], now, closesAt),
      ).toBe(false);
    });

    it('keeps a close-reaching window listed alongside a shorter one', () => {
      const overlapping = [
        {...phased[0]},
        {...phased[1], priorityStartsAt: '2026-10-29T12:00:00Z'},
      ];
      const now = new Date('2026-10-30T00:00:00Z');

      expect(
        activePriorityRegulations(overlapping, now, closesAt).map(r => r.id),
      ).toEqual(['priority', 'general']);
      expect(
        isRegulationSelectionAllowed(overlapping, ['general'], now, closesAt),
      ).toBe(true);
    });

    it('counts a window ending in the minute of the close', () => {
      const general = {
        id: 'general',
        priorityStartsAt: '2026-10-31T12:00:00Z',
        priorityEndsAt: '2026-12-25T11:59:00Z',
      };

      expect(
        activePriorityRegulations(
          [phased[0], general],
          new Date('2026-11-01T00:00:00Z'),
          '2026-12-25T11:59:59Z',
        ),
      ).toEqual([]);
    });

    it('still gates on a window with none ended before it', () => {
      const now = new Date('2026-11-01T00:00:00Z');
      const only = {...phased[1]};
      const other = {id: 'other', priorityStartsAt: null, priorityEndsAt: null};

      expect(
        activePriorityRegulations([only, other], now, closesAt).map(r => r.id),
      ).toEqual(['general']);
      expect(
        isRegulationSelectionAllowed([only, other], ['other'], now, closesAt),
      ).toBe(false);
    });

    it('leaves a window ending earlier than that as priority', () => {
      const general = {
        id: 'general',
        priorityStartsAt: '2026-10-31T12:00:00Z',
        priorityEndsAt: '2026-12-19T12:00:00Z',
      };

      expect(
        activePriorityRegulations(
          [phased[0], general],
          new Date('2026-11-01T00:00:00Z'),
          closesAt,
        ).map(r => r.id),
      ).toEqual(['general']);
    });
  });
});
