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
        entryOpensAt: '2026-11-01T00:00:00Z',
        entryClosesAt: '2026-11-30T00:00:00Z',
        entryPath: '/tokyo/saikyoi/entry',
      },
      {
        name: '東京新人王',
        typeLabel: '新人王',
        status: 'upcoming',
        entryOpensAt: '2026-12-01T00:00:00Z',
        entryClosesAt: '2026-12-31T00:00:00Z',
        entryPath: '/tokyo/shinjinou/entry',
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
        entryOpensAt: '2026-09-01T00:00:00Z',
        entryClosesAt: '2026-09-30T00:00:00Z',
        entryPath: '/hokkaido/saikyoi/entry',
      },
    ],
  },
];

function renderPage(regions: PortalRegionView[]): void {
  render(Page, {props: {params: {}, data: {regions}, form: null}});
}

describe('portal +page.svelte', () => {
  it('links to the mypage login screen', () => {
    renderPage(REGIONS);

    expect(
      screen.getByRole('link', {name: 'マイページにログイン'}),
    ).toHaveAttribute('href', '/mypage/login');
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

  it('says where each entry period stands, with the period in JST', () => {
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
