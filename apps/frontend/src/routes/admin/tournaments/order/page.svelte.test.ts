import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import Page from './+page.svelte';
import type {StaffClaims} from '@regional-quiz/shared';
import type {OrderedTournament} from './+page.server';

const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

const TOURNAMENTS: OrderedTournament[] = [
  {id: 'b', regionName: '東京', typeLabel: '新人王', name: '東京新人王'},
  {id: 'a', regionName: '東京', typeLabel: '最強位', name: '東京最強位'},
];

type Form = {saved: boolean; error: string | null} | null;

function renderPage(tournaments: OrderedTournament[], form: Form = null) {
  render(Page, {
    props: {
      params: {},
      data: {staff: STAFF, tournaments},
      form,
    },
  });
}

describe('admin tournament order +page.svelte', () => {
  it('numbers each tournament with its current position', () => {
    renderPage(TOURNAMENTS);

    expect(screen.getByLabelText('東京新人王の表示順')).toHaveValue(1);
    expect(screen.getByLabelText('東京最強位の表示順')).toHaveValue(2);
  });

  it('says the order was saved', () => {
    renderPage(TOURNAMENTS, {saved: true, error: null});

    expect(screen.getByRole('status')).toHaveTextContent(
      '表示順を保存しました',
    );
  });

  it('shows why a save was refused', () => {
    renderPage(TOURNAMENTS, {saved: false, error: '読み込み直してください'});

    expect(screen.getByRole('alert')).toHaveTextContent(
      '読み込み直してください',
    );
  });

  it('says so when there is no tournament to order', () => {
    renderPage([]);

    expect(screen.getByText('大会はまだありません。')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '保存'}),
    ).not.toBeInTheDocument();
  });

  it('moves a tournament with the arrow buttons, renumbering the rows', async () => {
    const user = userEvent.setup();
    renderPage(TOURNAMENTS);

    await user.click(
      screen.getByRole('button', {name: '東京最強位を上へ移動'}),
    );

    expect(screen.getByLabelText('東京最強位の表示順')).toHaveValue(1);
    expect(screen.getByLabelText('東京新人王の表示順')).toHaveValue(2);
    // The ids go with their rows, so the form saves the order on screen.
    const ids = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    ).map(input => [input.name, input.value]);
    expect(ids).toEqual([
      ['tournaments[0].id', 'a'],
      ['tournaments[1].id', 'b'],
    ]);
    expect(
      screen.getByText('東京最強位を1番目に移動しました'),
    ).toBeInTheDocument();
  });

  it('keeps focus on the moved row, passing it on at the end of the list', async () => {
    const user = userEvent.setup();
    renderPage([
      ...TOURNAMENTS,
      {id: 'c', regionName: '大阪', typeLabel: '最強位', name: '大阪最強位'},
    ]);

    await user.click(
      screen.getByRole('button', {name: '東京新人王を下へ移動'}),
    );
    expect(
      screen.getByRole('button', {name: '東京新人王を下へ移動'}),
    ).toHaveFocus();

    await user.click(
      screen.getByRole('button', {name: '東京新人王を下へ移動'}),
    );
    expect(
      screen.getByRole('button', {name: '東京新人王を下へ移動'}),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {name: '東京新人王を上へ移動'}),
    ).toHaveFocus();
  });

  it('offers a drag handle on every row', () => {
    renderPage(TOURNAMENTS);

    expect(document.querySelectorAll('tr[data-drag-item]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-drag-handle]')).toHaveLength(2);
  });
});
