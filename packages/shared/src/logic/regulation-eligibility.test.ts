import {describe, expect, it} from 'bun:test';
import {isRegulationSelectionAllowed} from './regulation-eligibility';

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
      ),
    ).toBe(false);
  });
});
