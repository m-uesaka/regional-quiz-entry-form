import {render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {PortalRegionView} from '$lib/portal';
import Page from './+page.svelte';

const REGIONS: PortalRegionView[] = [
  {
    regionSlug: 'tokyo',
    regionName: '東京',
    allowsDualEntry: true,
    tournaments: [
      {
        name: '東京最強位',
        typeLabel: '最強位',
        status: 'open',
        entryPeriodLabel: '2026年11月1日(日) 9:00 〜 2026年11月30日(月) 9:00',
        capacityLabel: '定員: 48名',
        priorityNotices: [
          {
            labels: ['開催地域に在住の方', '開催地域に在学の方'],
            endsAtLabel: '2026年11月5日(木) 9:00',
          },
        ],
        entryPath: '/tokyo/saikyoi/entry',
        entryListPath: '/tokyo/saikyoi/list',
      },
      {
        name: '東京新人王',
        typeLabel: '新人王',
        status: 'upcoming',
        entryPeriodLabel: '2026年12月1日(火) 9:00 〜 2026年12月31日(木) 9:00',
        capacityLabel: null,
        priorityNotices: [],
        entryPath: '/tokyo/shinjinou/entry',
        entryListPath: '/tokyo/shinjinou/list',
      },
    ],
  },
  {
    regionSlug: 'hokkaido',
    regionName: '北海道',
    allowsDualEntry: false,
    tournaments: [
      {
        name: '北海道最強位',
        typeLabel: '最強位',
        status: 'closed',
        entryPeriodLabel: '2026年9月1日(火) 9:00 〜 2026年9月30日(水) 9:00',
        capacityLabel: null,
        priorityNotices: [],
        entryPath: '/hokkaido/saikyoi/entry',
        entryListPath: '/hokkaido/saikyoi/list',
      },
    ],
  },
];

function renderPage(regions: PortalRegionView[]): void {
  render(Page, {props: {params: {}, data: {regions}, form: null}});
}

describe('portal +page.svelte', () => {
  // `/mypage` rather than `/mypage/login`: the mypage layout sends a
  // visitor without a session to the login screen anyway, and one who is
  // already logged in goes straight to their entries.
  it('links to the mypage', () => {
    renderPage(REGIONS);

    expect(screen.getByRole('link', {name: 'マイページへ'})).toHaveAttribute(
      'href',
      '/mypage',
    );
  });

  it('lists every region with its tournaments', () => {
    renderPage(REGIONS);

    expect(screen.getByRole('heading', {level: 3, name: '東京'})).toBeVisible();
    expect(
      screen.getByRole('heading', {level: 3, name: '北海道'}),
    ).toBeVisible();
    expect(screen.getByText('東京新人王')).toBeInTheDocument();
    expect(screen.getByText('北海道最強位')).toBeInTheDocument();
  });

  it('shows the capacity and the 優先エントリー going on now', () => {
    renderPage(REGIONS);

    expect(screen.getByText('定員: 48名')).toBeInTheDocument();
    expect(
      screen.getByText(
        '現在優先エントリー実施中です。該当レギュレーション: 「開催地域に在住の方」「開催地域に在学の方」、〜2026年11月5日(木) 9:00まで',
      ),
    ).toBeInTheDocument();
  });

  it('links only the forms that are taking entries', () => {
    renderPage(REGIONS);

    expect(
      screen.getByRole('link', {name: '東京最強位にエントリーする'}),
    ).toHaveAttribute('href', '/tokyo/saikyoi/entry');
    expect(
      screen.queryByRole('link', {name: '東京新人王にエントリーする'}),
    ).toBeNull();
    expect(
      screen.queryByRole('link', {name: '北海道最強位にエントリーする'}),
    ).toBeNull();
  });

  it('says where each entry period stands, with the period', () => {
    renderPage(REGIONS);

    const upcoming = screen.getByText('東京新人王').closest('li');
    expect(upcoming).not.toBeNull();
    expect(within(upcoming!).getByText('受付開始前')).toBeInTheDocument();
    expect(upcoming).toHaveTextContent(
      '受付期間: 2026年12月1日(火) 9:00 〜 2026年12月31日(木) 9:00',
    );

    const closed = screen.getByText('北海道最強位').closest('li');
    expect(within(closed!).getByText('受付終了')).toBeInTheDocument();
  });

  it('says which regions take entries for both 最強位 and 新人王', () => {
    renderPage(REGIONS);

    const notice =
      'この地域は最強位と新人王の両方にエントリー可能です(重複エントリー可)';
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(
      within(screen.getByRole('region', {name: '東京'})).getByText(notice),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', {name: '北海道'})).queryByText(notice),
    ).toBeNull();
  });

  // It is the region's rule, so it stays while a form is closed; the
  // form's own status says when it takes entries.
  it('keeps the notice while one of the forms is not taking entries', () => {
    const [tokyo] = REGIONS;
    renderPage([
      {
        ...tokyo,
        tournaments: tokyo.tournaments.map(t => ({...t, status: 'closed'})),
      },
    ]);

    expect(
      screen.getByText(
        'この地域は最強位と新人王の両方にエントリー可能です(重複エントリー可)',
      ),
    ).toBeInTheDocument();
  });

  it('says so when no tournament has been published', () => {
    renderPage([]);

    expect(
      screen.getByText('現在公開されている大会はありません。'),
    ).toBeInTheDocument();
  });
});
