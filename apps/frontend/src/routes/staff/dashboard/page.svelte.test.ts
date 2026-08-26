import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {DashboardTournamentSummary} from '@regional-quiz/shared';
import Page from './+page.svelte';

const TOKYO: DashboardTournamentSummary = {
  tournamentId: '00000000-0000-0000-0000-000000000001',
  tournamentName: '東京大会',
  tournamentType: 'saikyoi',
  regionId: '00000000-0000-0000-0000-000000000002',
  regionSlug: 'tokyo',
  regionName: '東京',
  capacity: 100,
  confirmedCount: 80,
  waitlistedCount: 12,
  pendingVerificationCount: 3,
  cancelledCount: 5,
};

const OSAKA: DashboardTournamentSummary = {
  tournamentId: '00000000-0000-0000-0000-000000000003',
  tournamentName: '大阪大会',
  tournamentType: 'shinjinou',
  regionId: '00000000-0000-0000-0000-000000000004',
  regionSlug: 'osaka',
  regionName: '大阪',
  capacity: null,
  confirmedCount: 7,
  waitlistedCount: 0,
  pendingVerificationCount: 1,
  cancelledCount: 0,
};

function renderPage(summaries: DashboardTournamentSummary[]) {
  render(Page, {
    props: {params: {}, data: {summaries}, form: null},
  });
}

describe('staff dashboard +page.svelte', () => {
  it('lists every region with its counts and fill rate', () => {
    renderPage([TOKYO, OSAKA]);

    expect(screen.getByText('東京')).toBeInTheDocument();
    expect(screen.getByText('大阪')).toBeInTheDocument();
    expect(screen.getByText(/東京大会/)).toHaveTextContent('東京大会 (最強位)');
    expect(screen.getByText(/大阪大会/)).toHaveTextContent('大阪大会 (新人王)');
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows a dash instead of a fill rate for an uncapped tournament', () => {
    renderPage([OSAKA]);

    expect(screen.getByText('制限なし')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('totals the counts across every region', () => {
    renderPage([TOKYO, OSAKA]);

    expect(
      screen.getByText(/確定 87 件 \/ キャンセル待ち 12 件/),
    ).toBeInTheDocument();
  });

  it('links each tournament to its own staff entry list', () => {
    renderPage([TOKYO, OSAKA]);

    expect(
      screen.getByRole('link', {name: '東京 東京大会のエントリー一覧'}),
    ).toHaveAttribute('href', '/staff/tokyo/saikyoi/entries');
    expect(
      screen.getByRole('link', {name: '大阪 大阪大会のエントリー一覧'}),
    ).toHaveAttribute('href', '/staff/osaka/shinjinou/entries');
  });

  it('tells staff when no tournament exists yet', () => {
    renderPage([]);

    expect(
      screen.getByText('大会がまだ登録されていません。'),
    ).toBeInTheDocument();
  });
});
