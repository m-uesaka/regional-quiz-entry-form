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

describe('RegulationSelector', () => {
  it('disables a regulation outside the currently active priority window', () => {
    const now = new Date('2026-08-23T00:00:00Z');
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
        value: null,
        now,
      },
    });

    const generalOption = screen.getByRole('radio', {name: /一般枠/});
    expect(generalOption).toBeDisabled();
    expect(
      screen.getByText('優先期間中のため選択できません'),
    ).toBeInTheDocument();

    const priorityOption = screen.getByRole('radio', {name: /優先枠/});
    expect(priorityOption).not.toBeDisabled();
  });

  it('submits the selected id under the regulationId control name', async () => {
    const user = userEvent.setup();
    const regulationA = buildRegulation({
      id: '11111111-1111-1111-1111-111111111111',
      label: 'A部門',
      displayOrder: 0,
    });
    const regulationB = buildRegulation({
      id: '22222222-2222-2222-2222-222222222222',
      label: 'B部門',
      displayOrder: 1,
    });

    render(RegulationSelector, {
      props: {
        regulations: [regulationA, regulationB],
        value: null,
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    const chosen = screen.getByRole('radio', {name: 'B部門'});
    await user.click(chosen);

    expect(chosen).toBeChecked();
    expect(chosen).toHaveAttribute('name', 'regulationId');
    expect(chosen).toHaveAttribute('value', regulationB.id);
    expect(screen.getByRole('radio', {name: 'A部門'})).not.toBeChecked();
  });

  it('preselects the regulation it was given', () => {
    const regulationA = buildRegulation({
      id: '11111111-1111-1111-1111-111111111111',
      label: 'A部門',
      displayOrder: 0,
    });
    const regulationB = buildRegulation({
      id: '22222222-2222-2222-2222-222222222222',
      label: 'B部門',
      displayOrder: 1,
    });

    render(RegulationSelector, {
      props: {
        regulations: [regulationA, regulationB],
        value: regulationB.id,
        now: new Date('2026-08-23T00:00:00Z'),
      },
    });

    expect(screen.getByRole('radio', {name: 'B部門'})).toBeChecked();
  });
});
