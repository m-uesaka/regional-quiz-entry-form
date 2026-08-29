import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import type {Regulation} from '@regional-quiz/shared';
import RegulationSelector from './RegulationSelector.svelte';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000000';

function buildRegulation(overrides: Partial<Regulation>): Regulation {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tournamentId: TOURNAMENT_ID,
    label: '一般部門',
    priorityStartsAt: null,
    priorityEndsAt: null,
    displayOrder: 0,
    ...overrides,
  };
}

const REGULATION_A = buildRegulation({
  id: '11111111-1111-1111-1111-111111111111',
  label: 'A部門',
  displayOrder: 0,
});
const REGULATION_B = buildRegulation({
  id: '22222222-2222-2222-2222-222222222222',
  label: 'B部門',
  displayOrder: 1,
});

describe('RegulationSelector', () => {
  it('marks the priority regulations and asks for one during their window', () => {
    const priorityRegulation = buildRegulation({
      id: '11111111-1111-1111-1111-111111111111',
      label: '優先枠',
      priorityStartsAt: '2026-08-01T00:00:00+09:00',
      priorityEndsAt: '2026-08-31T00:00:00+09:00',
    });
    const generalRegulation = buildRegulation({
      id: '22222222-2222-2222-2222-222222222222',
      label: '一般枠',
      displayOrder: 1,
    });

    render(RegulationSelector, {
      props: {
        regulations: [priorityRegulation, generalRegulation],
        value: [],
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    // Nothing is disabled: a participant meeting the priority condition may
    // also claim the general one, so the rule is "at least one priority
    // regulation", not "only priority regulations".
    expect(screen.getByRole('checkbox', {name: /一般枠/})).not.toBeDisabled();
    expect(screen.getByRole('checkbox', {name: /優先枠/})).not.toBeDisabled();
    expect(
      screen.getByText(
        '現在は優先期間中です。優先対象のレギュレーションを1つ以上選択してください',
      ),
    ).toBeInTheDocument();
  });

  it('reports a selection that claims no active priority regulation', () => {
    const priorityRegulation = buildRegulation({
      id: '11111111-1111-1111-1111-111111111111',
      label: '優先枠',
      priorityStartsAt: '2026-08-01T00:00:00+09:00',
      priorityEndsAt: '2026-08-31T00:00:00+09:00',
    });
    const generalRegulation = buildRegulation({
      id: '22222222-2222-2222-2222-222222222222',
      label: '一般枠',
      displayOrder: 1,
    });

    render(RegulationSelector, {
      props: {
        regulations: [priorityRegulation, generalRegulation],
        value: [generalRegulation.id],
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    expect(
      screen.getByText(
        '現在は優先期間中のため、優先対象のレギュレーションを1つ以上選択してください',
      ),
    ).toBeInTheDocument();
  });

  it('submits every checked id under the regulationIds control name', async () => {
    const user = userEvent.setup();

    render(RegulationSelector, {
      props: {
        regulations: [REGULATION_A, REGULATION_B],
        value: [],
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    const first = screen.getByRole('checkbox', {name: 'A部門'});
    const second = screen.getByRole('checkbox', {name: 'B部門'});
    await user.click(first);
    await user.click(second);

    expect(first).toBeChecked();
    expect(second).toBeChecked();
    for (const box of [first, second]) {
      expect(box).toHaveAttribute('name', 'regulationIds');
    }
    expect(first).toHaveAttribute('value', REGULATION_A.id);
    expect(second).toHaveAttribute('value', REGULATION_B.id);
  });

  it('preselects the regulations it was given', () => {
    render(RegulationSelector, {
      props: {
        regulations: [REGULATION_A, REGULATION_B],
        value: [REGULATION_B.id],
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    expect(screen.getByRole('checkbox', {name: 'B部門'})).toBeChecked();
    expect(screen.getByRole('checkbox', {name: 'A部門'})).not.toBeChecked();
  });

  it('says nothing about priority windows when none is active', () => {
    render(RegulationSelector, {
      props: {
        regulations: [REGULATION_A, REGULATION_B],
        value: [],
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    expect(screen.queryByText(/優先期間/)).not.toBeInTheDocument();
  });
});
