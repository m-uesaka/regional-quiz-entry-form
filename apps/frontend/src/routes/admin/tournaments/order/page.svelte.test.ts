import {render, screen} from '@testing-library/svelte';
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
});
