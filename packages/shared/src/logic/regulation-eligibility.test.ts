import {describe, expect, it} from 'bun:test';
import {
  activePriorityRegulations,
  regulationSelectionRefusal,
  selectableRegulations,
} from './regulation-eligibility';

describe('regulationSelectionRefusal', () => {
  it('rejects an empty selection', () => {
    const regulations = [
      {
        id: 'reg-1',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
      {
        id: 'reg-2',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
    ];

    expect(
      regulationSelectionRefusal(
        regulations,
        [],
        new Date('2026-08-23T00:00:00Z'),
      ),
    ).toBe('empty');
  });

  it('accepts any selection when no priority window is active', () => {
    const regulations = [
      {
        id: 'reg-1',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
      {
        id: 'reg-2',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
    ];

    expect(
      regulationSelectionRefusal(
        regulations,
        ['reg-1', 'reg-2'],
        new Date('2026-08-23T00:00:00Z'),
      ),
    ).toBeNull();
  });

  it('accepts a selection containing one active priority regulation', () => {
    const regulations = [
      {
        id: 'priority-reg',
        priorityStartsAt: '2026-08-01T00:00:00Z',
        priorityEndsAt: '2026-08-31T00:00:00Z',
        closesWithPriority: false,
      },
      {
        id: 'other-reg',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
    ];

    expect(
      regulationSelectionRefusal(
        regulations,
        ['other-reg', 'priority-reg'],
        new Date('2026-08-15T00:00:00Z'),
      ),
    ).toBeNull();
  });

  it('rejects a selection of only non-priority regulations during a window', () => {
    const regulations = [
      {
        id: 'priority-reg',
        priorityStartsAt: '2026-08-01T00:00:00Z',
        priorityEndsAt: '2026-08-31T00:00:00Z',
        closesWithPriority: false,
      },
      {
        id: 'other-reg',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
    ];

    expect(
      regulationSelectionRefusal(
        regulations,
        ['other-reg'],
        new Date('2026-08-15T00:00:00Z'),
      ),
    ).toBe('needs-priority');
  });

  it('opens up after the priority window ends', () => {
    const regulations = [
      {
        id: 'priority-reg',
        priorityStartsAt: '2026-08-01T00:00:00Z',
        priorityEndsAt: '2026-08-31T00:00:00Z',
        closesWithPriority: false,
      },
      {
        id: 'other-reg',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
    ];

    expect(
      regulationSelectionRefusal(
        regulations,
        ['other-reg'],
        new Date('2026-09-01T00:00:00Z'),
      ),
    ).toBeNull();
  });

  it('rejects a selection containing an unknown regulation id', () => {
    const regulations = [
      {
        id: 'reg-1',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
      {
        id: 'reg-2',
        priorityStartsAt: null,
        priorityEndsAt: null,
        closesWithPriority: false,
      },
    ];

    expect(
      regulationSelectionRefusal(
        regulations,
        ['reg-1', 'unknown-reg'],
        new Date('2026-08-23T00:00:00Z'),
      ),
    ).toBe('not-offered');
  });
});

describe('activePriorityRegulations', () => {
  const regulations = [
    {
      id: 'none',
      label: '条件なし',
      priorityStartsAt: null,
      priorityEndsAt: null,
      closesWithPriority: false,
    },
    {
      id: 'open',
      label: '在住',
      priorityStartsAt: '2026-11-01T00:00:00Z',
      priorityEndsAt: '2026-11-05T00:00:00Z',
      closesWithPriority: false,
    },
    {
      id: 'later',
      label: '在学',
      priorityStartsAt: '2026-11-10T00:00:00Z',
      priorityEndsAt: '2026-11-12T00:00:00Z',
      closesWithPriority: false,
    },
  ];

  it('lists only the windows open at that moment, keeping their fields', () => {
    const active = activePriorityRegulations(
      regulations,
      new Date('2026-11-03T00:00:00Z'),
    );

    expect(active.map(r => [r.id, r.label])).toEqual([['open', '在住']]);
  });

  it('counts both ends of a window as inside it', () => {
    const ids = (now: string) =>
      activePriorityRegulations(regulations, new Date(now)).map(r => r.id);

    expect(ids('2026-11-01T00:00:00Z')).toEqual(['open']);
    expect(ids('2026-11-05T00:00:00Z')).toEqual(['open']);
    expect(ids('2026-11-05T00:00:01Z')).toEqual([]);
  });

  // #243: staff mark the regulations that close with their priority.
  describe('with regulations marked to close', () => {
    const priority = {
      id: 'priority',
      priorityStartsAt: '2026-10-29T12:00:00Z',
      priorityEndsAt: '2026-10-31T12:00:00Z',
      closesWithPriority: true,
    };
    const general = {
      id: 'general',
      priorityStartsAt: null,
      priorityEndsAt: null,
      closesWithPriority: false,
    };
    // How a general phase was set up before #243, and may still be stored.
    const generalWindow = {
      ...general,
      priorityStartsAt: '2026-10-31T12:00:00Z',
      priorityEndsAt: '2026-12-25T12:00:00Z',
    };
    type Regulations = ReadonlyArray<typeof priority | typeof general>;
    const listed = (regulations: Regulations, now: string) =>
      activePriorityRegulations(regulations, new Date(now)).map(r => r.id);
    const selectable = (regulations: Regulations, now: string) =>
      selectableRegulations(regulations, new Date(now)).map(r => r.id);
    const AFTER = '2026-10-31T12:00:01Z';

    it('needs no window on the general regulation', () => {
      const regulations = [priority, general];

      expect(selectable(regulations, '2026-10-30T00:00:00Z')).toEqual([
        'priority',
        'general',
      ]);
      expect(selectable(regulations, AFTER)).toEqual(['general']);
      expect(listed(regulations, AFTER)).toEqual([]);
    });

    it('keeps the regulation up to the end of its window, included', () => {
      expect(selectable([priority, general], priority.priorityEndsAt)).toEqual([
        'priority',
        'general',
      ]);
    });

    it('still gates the entries while the priority window is open', () => {
      expect(
        regulationSelectionRefusal(
          [priority, general],
          ['general'],
          new Date('2026-10-30T00:00:00Z'),
        ),
      ).toBe('needs-priority');
    });

    // A form overtaken by a change either way: telling it to choose again is
    // what helps, whatever else it names.
    it('calls a phase that is over and a deleted id alike not offered', () => {
      const now = new Date(AFTER);
      const regulations = [priority, general];

      for (const ids of [
        ['priority'],
        ['priority', 'general'],
        ['priority', 'unknown-reg'],
        ['unknown-reg'],
      ]) {
        expect(regulationSelectionRefusal(regulations, ids, now)).toBe(
          'not-offered',
        );
      }
      expect(
        regulationSelectionRefusal(regulations, ['general'], now),
      ).toBeNull();
    });

    it('keeps a regulation that is not marked', () => {
      const resident = {...priority, closesWithPriority: false};

      expect(selectable([resident, general], AFTER)).toEqual([
        'priority',
        'general',
      ]);
    });

    it('ignores the mark on a regulation with no window', () => {
      const marked = {...general, closesWithPriority: true};

      expect(selectable([marked, general], AFTER)).toEqual([
        'general',
        'general',
      ]);
    });

    // Issue limit: the marker doesn't lean on the close, so moving the close
    // or ending the general window early changes nothing.
    it('does not depend on a window reaching the close', () => {
      const short = {...generalWindow, priorityEndsAt: '2026-12-19T12:00:00Z'};

      expect(listed([priority, short], '2026-11-01T00:00:00Z')).toEqual([]);
      expect(selectable([priority, short], '2026-12-20T00:00:00Z')).toEqual([
        'general',
      ]);
    });

    it('treats a stored general window as opening the phase', () => {
      const regulations = [priority, generalWindow];

      expect(listed(regulations, AFTER)).toEqual([]);
      expect(selectable(regulations, AFTER)).toEqual(['general']);
    });

    // 北海道: both stay on offer until the window still to come starts.
    it('waits for a window still to start, and that window is the fix', () => {
      const later = {
        ...generalWindow,
        priorityStartsAt: '2026-11-01T00:00:00Z',
      };

      expect(selectable([priority, later], '2026-10-31T18:00:00Z')).toEqual([
        'priority',
        'general',
      ]);
      expect(selectable([priority, later], '2026-11-01T00:00:00Z')).toEqual([
        'general',
      ]);
      expect(selectable([priority, general], '2026-10-31T18:00:00Z')).toEqual([
        'general',
      ]);
    });

    it('keeps an earlier phase on offer until a later one has ended', () => {
      const second = {
        ...priority,
        id: 'second',
        priorityStartsAt: '2026-10-31T12:00:00Z',
        priorityEndsAt: '2026-11-05T12:00:00Z',
      };
      const regulations = [priority, second, general];
      const during = '2026-11-01T00:00:00Z';

      expect(selectable(regulations, during)).toEqual([
        'priority',
        'second',
        'general',
      ]);
      expect(listed(regulations, during)).toEqual(['second']);
      expect(selectable(regulations, '2026-11-06T00:00:00Z')).toEqual([
        'general',
      ]);
    });

    it('keeps restricting on a window that began before the phase ended', () => {
      const resident = {
        ...general,
        id: 'resident',
        priorityStartsAt: '2026-10-29T12:00:00Z',
        priorityEndsAt: '2026-11-05T12:00:00Z',
      };
      const regulations = [priority, resident, general];

      expect(listed(regulations, '2026-11-01T00:00:00Z')).toEqual(['resident']);
      expect(
        regulationSelectionRefusal(
          regulations,
          ['general'],
          new Date('2026-11-01T00:00:00Z'),
        ),
      ).toBe('needs-priority');
    });
  });
});
