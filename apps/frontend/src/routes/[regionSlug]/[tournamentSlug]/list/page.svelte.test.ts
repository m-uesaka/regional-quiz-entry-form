import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {EntryListItem} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRIES: EntryListItem[] = [
  {
    displayName: '参加者A',
    status: 'confirmed',
    waitlistPosition: null,
    enteredAt: '2026-11-01T00:00:05.123456+00:00',
  },
  {
    displayName: '参加者B',
    status: 'waitlisted',
    waitlistPosition: 2,
    enteredAt: '2026-11-01T00:01:00+00:00',
  },
];

const NOTICES = [
  'エントリーした時間は，エントリーフォームを送信した時間のことです．',
  'エントリーリストにお名前がない場合，エントリー確認メールが来ていないか今一度確認ください．エントリー確認メールからエントリーを確定させたにもかかわらずエントリーリストに反映されない場合は，各地域の主催者にお問い合わせください．',
];

describe('list +page.svelte', () => {
  it('numbers each row and shows when it was sent, in JST', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: ENTRIES, total: 2, limit: 100, offset: 0},
        form: null,
      },
    });

    const rows = screen
      .getAllByRole('row')
      .slice(1)
      .map(row =>
        [...row.children].map(cell =>
          cell.textContent?.replace(/\s+/g, ' ').trim(),
        ),
      );
    expect(rows).toEqual([
      ['1', '参加者A', '2026年11月1日(日) 9:00:05'],
      ['2', '参加者B (キャンセル待ち 2)', '2026年11月1日(日) 9:01:00'],
    ]);
    expect(
      screen.getByRole('columnheader', {name: 'エントリーした時間'}),
    ).toBeInTheDocument();
  });

  it('carries the numbering on from the earlier pages', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: ENTRIES, total: 250, limit: 100, offset: 100},
        form: null,
      },
    });

    const numbers = screen
      .getAllByRole('row')
      .slice(1)
      .map(row => row.firstElementChild?.textContent?.trim());
    expect(numbers).toEqual(['101', '102']);
  });

  it.each([
    ['with entries', ENTRIES, 2],
    ['before anyone has entered', [], 0],
  ])('opens with the notices %s', (_, entries, total) => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries, total, limit: 100, offset: 0},
        form: null,
      },
    });

    expect(
      screen.getAllByRole('listitem').map(item => item.textContent?.trim()),
    ).toEqual(NOTICES);
  });

  it('shows the waitlist position for a waitlisted entry', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: ENTRIES, total: 2, limit: 100, offset: 0},
        form: null,
      },
    });

    expect(screen.getByText(/参加者B/)).toHaveTextContent(
      '参加者B (キャンセル待ち 2)',
    );
    expect(screen.getByText('参加者A')).toBeInTheDocument();
  });

  it('says so when there are no entries yet, instead of a blank page', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: [], total: 0, limit: 100, offset: 0},
        form: null,
      },
    });

    expect(
      screen.getByRole('heading', {level: 1, name: 'エントリーリスト'}),
    ).toBeInTheDocument();
    expect(
      screen.getByText('まだエントリーはありません。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('the pager renders the total count and disables the previous link on the first page', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: ENTRIES, total: 250, limit: 100, offset: 0},
        form: null,
      },
    });

    expect(screen.getByText('250 件中 1〜100 件')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '前へ'})).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const next = screen.getByRole('link', {name: '次へ'});
    expect(next).not.toHaveAttribute('aria-disabled');
    expect(next).toHaveAttribute('href', '?offset=100');
  });

  it('disables the next link on the last page', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: ENTRIES, total: 250, limit: 100, offset: 200},
        form: null,
      },
    });

    expect(screen.getByText('250 件中 201〜250 件')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '次へ'})).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', {name: '前へ'})).toHaveAttribute(
      'href',
      '?offset=100',
    );
  });

  it('on a stale page past the last row, says so and leads back to the last real page', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {entries: [], total: 250, limit: 100, offset: 1000},
        form: null,
      },
    });

    expect(
      screen.getByText('このページにはエントリーがありません。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('250 件')).toBeInTheDocument();
    // Straight to the last page (201–250), not one empty page back.
    expect(screen.getByRole('link', {name: '前へ'})).toHaveAttribute(
      'href',
      '?offset=200',
    );
  });
});
