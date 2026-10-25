import {render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {PortalRegionView} from '$lib/portal';
import Page from './+page.svelte';

const REGIONS: PortalRegionView[] = [
  {
    regionSlug: 'tokyo',
    regionName: '東京',
    tournaments: [
      {
        name: '東京最強位',
        typeLabel: '最強位',
        status: 'open',
        entryPeriodLabel: '2026年11月1日(日) 9:00 〜 2026年11月30日(月) 9:00',
        entryPath: '/tokyo/saikyoi/entry',
        entryListPath: '/tokyo/saikyoi/list',
      },
      {
        name: '東京新人王',
        typeLabel: '新人王',
        status: 'upcoming',
        entryPeriodLabel: '2026年12月1日(火) 9:00 〜 2026年12月31日(木) 9:00',
        entryPath: '/tokyo/shinjinou/entry',
        entryListPath: '/tokyo/shinjinou/list',
      },
    ],
  },
  {
    regionSlug: 'hokkaido',
    regionName: '北海道',
    tournaments: [
      {
        name: '北海道最強位',
        typeLabel: '最強位',
        status: 'closed',
        entryPeriodLabel: '2026年9月1日(火) 9:00 〜 2026年9月30日(水) 9:00',
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

  it('says so when no tournament has been published', () => {
    renderPage([]);

    expect(
      screen.getByText('現在公開されている大会はありません。'),
    ).toBeInTheDocument();
  });
});
