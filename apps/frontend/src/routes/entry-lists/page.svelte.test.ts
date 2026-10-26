import {render, screen} from '@testing-library/svelte';
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
        status: 'closed',
        entryPeriodLabel: '',
        capacityLabel: null,
        priorityNotices: [],
        entryPath: '/tokyo/saikyoi/entry',
        entryListPath: '/tokyo/saikyoi/list',
      },
      {
        name: '東京新人王',
        typeLabel: '新人王',
        status: 'upcoming',
        entryPeriodLabel: '',
        capacityLabel: null,
        priorityNotices: [],
        entryPath: '/tokyo/shinjinou/entry',
        entryListPath: '/tokyo/shinjinou/list',
      },
    ],
  },
];

function renderPage(regions: PortalRegionView[]) {
  render(Page, {props: {params: {}, data: {regions}, form: null}});
}

describe('entry-lists +page.svelte', () => {
  it("links to every tournament's entry list, whatever its entry period", () => {
    renderPage(REGIONS);

    expect(screen.getByRole('heading', {name: '東京'})).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: '東京最強位(最強位)のエントリーリスト'}),
    ).toHaveAttribute('href', '/tokyo/saikyoi/list');
    expect(
      screen.getByRole('link', {name: '東京新人王(新人王)のエントリーリスト'}),
    ).toHaveAttribute('href', '/tokyo/shinjinou/list');
  });

  it('says so when no tournament is published', () => {
    renderPage([]);

    expect(
      screen.getByText('現在公開されている大会はありません。'),
    ).toBeInTheDocument();
  });
});
