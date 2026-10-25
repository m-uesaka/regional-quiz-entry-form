import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {PortalRegionView, PortalTournamentView} from '$lib/portal';
import Page from './+page.svelte';

function tournament(
  overrides: Partial<PortalTournamentView> &
    Pick<PortalTournamentView, 'name' | 'entryListPath'>,
): PortalTournamentView {
  return {
    typeLabel: '最強位',
    status: 'open',
    entryPeriodLabel: '',
    entryPath: overrides.entryListPath.replace(/\/list$/, '/entry'),
    ...overrides,
  };
}

const TOKYO: PortalRegionView = {
  regionSlug: 'tokyo',
  regionName: '東京',
  tournaments: [
    tournament({name: '東京最強位', entryListPath: '/tokyo/saikyoi/list'}),
    tournament({
      name: '東京新人王',
      typeLabel: '新人王',
      status: 'closed',
      entryListPath: '/tokyo/shinjinou/list',
    }),
  ],
};

const HOKKAIDO: PortalRegionView = {
  regionSlug: 'hokkaido',
  regionName: '北海道',
  tournaments: [
    tournament({
      name: '北海道最強位',
      status: 'upcoming',
      entryListPath: '/hokkaido/saikyoi/list',
    }),
  ],
};

function renderPage(regions: PortalRegionView[] | null = []) {
  render(Page, {props: {params: {}, data: {regions}, form: null}});
}

describe('top +page.svelte', () => {
  it('leads participants to the entry portal and to their mypage', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'エントリーポータル'}),
    ).toHaveAttribute('href', '/portal');
    expect(screen.getByRole('link', {name: 'マイページ'})).toHaveAttribute(
      'href',
      '/mypage',
    );
  });

  it('leads staff to their login screen', () => {
    renderPage();

    expect(
      screen.getByRole('link', {name: 'スタッフログイン'}),
    ).toHaveAttribute('href', '/staff/login');
  });

  it("links to each tournament's published entry list, open or closed", () => {
    renderPage([TOKYO]);

    expect(
      screen.getByRole('link', {name: '東京最強位(最強位)のエントリーリスト'}),
    ).toHaveAttribute('href', '/tokyo/saikyoi/list');
    expect(
      screen.getByRole('link', {name: '東京新人王(新人王)のエントリーリスト'}),
    ).toHaveAttribute('href', '/tokyo/shinjinou/list');
  });

  it('leaves out tournaments whose entries have not opened yet', () => {
    renderPage([TOKYO, HOKKAIDO]);

    expect(screen.queryByText('北海道')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', {name: /北海道最強位/}),
    ).not.toBeInTheDocument();
  });

  it('says so when no entry list is published yet', () => {
    renderPage([HOKKAIDO]);

    expect(
      screen.getByText('公開されているエントリーリストはまだありません。'),
    ).toBeInTheDocument();
  });

  it('keeps the rest of the page when the tournaments could not be read', () => {
    renderPage(null);

    expect(
      screen.getByText(
        '大会一覧を読み込めませんでした。時間をおいて再度お試しください。',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'エントリーポータル'}),
    ).toBeInTheDocument();
  });
});
