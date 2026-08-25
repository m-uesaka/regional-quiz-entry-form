import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {MypageEntry} from '@regional-quiz/shared';
import Page from './+page.svelte';

const OPEN_PERIOD = {
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
};

const ENTRIES: MypageEntry[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    tournamentId: '00000000-0000-0000-0000-000000000002',
    status: 'confirmed',
    waitlistPosition: null,
    tournament: {
      name: 'テスト地域大会',
      type: 'saikyoi',
      regionId: '00000000-0000-0000-0000-000000000003',
      ...OPEN_PERIOD,
    },
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    tournamentId: '00000000-0000-0000-0000-000000000005',
    status: 'waitlisted',
    waitlistPosition: 2,
    tournament: {
      name: 'テスト地域大会',
      type: 'shinjinou',
      regionId: '00000000-0000-0000-0000-000000000003',
      ...OPEN_PERIOD,
    },
  },
];

function renderPage(entries: MypageEntry[]) {
  render(Page, {props: {params: {}, data: {entries}, form: null}});
}

describe('mypage +page.svelte', () => {
  it('shows an entry for both the saikyoi and shinjinou tournament in the region', () => {
    renderPage(ENTRIES);

    expect(screen.getByText(/最強位/)).toBeInTheDocument();
    expect(screen.getByText(/新人王/)).toBeInTheDocument();
  });

  it('links each entry to its own edit page', () => {
    renderPage(ENTRIES);

    const links = screen.getAllByRole('link', {name: '編集する'});
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      `/mypage/entries/${ENTRIES[0].id}/edit`,
      `/mypage/entries/${ENTRIES[1].id}/edit`,
    ]);
  });

  it('offers no edit link once the entry period has closed', () => {
    renderPage([
      {
        ...ENTRIES[0],
        tournament: {
          ...ENTRIES[0].tournament,
          entryClosesAt: '2020-01-02T00:00:00.000Z',
        },
      },
    ]);

    expect(
      screen.queryByRole('link', {name: '編集する'}),
    ).not.toBeInTheDocument();
  });

  it('offers no edit link for a cancelled entry', () => {
    renderPage([{...ENTRIES[0], status: 'cancelled'}]);

    expect(
      screen.queryByRole('link', {name: '編集する'}),
    ).not.toBeInTheDocument();
  });
});
