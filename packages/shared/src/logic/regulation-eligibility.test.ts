import {describe, expect, it} from 'bun:test';
import {isRegulationSelectionAllowed} from './regulation-eligibility';

describe('isRegulationSelectionAllowed', () => {
  it('allows any regulation when no priority window is active', () => {
    const regulations = [
      {id: 'reg-1', priorityStartsAt: null, priorityEndsAt: null},
      {id: 'reg-2', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        'reg-2',
        new Date('2026-08-23T00:00:00Z'),
      ),
    ).toBe(true);
  });

  it('restricts to priority regulations during their window', () => {
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
        'other-reg',
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
        'other-reg',
        new Date('2026-09-01T00:00:00Z'),
      ),
    ).toBe(true);
  });

  it('rejects an unknown regulation id even with no active priority window', () => {
    const regulations = [
      {id: 'reg-1', priorityStartsAt: null, priorityEndsAt: null},
      {id: 'reg-2', priorityStartsAt: null, priorityEndsAt: null},
    ];

    expect(
      isRegulationSelectionAllowed(
        regulations,
        'unknown-reg',
        new Date('2026-08-23T00:00:00Z'),
      ),
    ).toBe(false);
  });
});
