import {render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {Entry, Tournament} from '@regional-quiz/shared';
import Page from './+page.svelte';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
};

const ENTRIES: Entry[] = [
  {
    id: '00000000-0000-0000-0000-000000000004',
    tournamentId: TOURNAMENT.id,
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '参加者A',
    email: 'taro@example.com',
    regulationIds: ['00000000-0000-0000-0000-000000000005'],
    regulationLabels: ['一般の部'],
    freeText: null,
    customFieldValues: {},
    status: 'confirmed',
    waitlistPosition: null,
  },
  {
    id: '00000000-0000-0000-0000-000000000006',
    tournamentId: TOURNAMENT.id,
    name: '鈴木次郎',
    furigana: 'スズキジロウ',
    displayName: '参加者B',
    email: 'jiro@example.com',
    regulationIds: ['00000000-0000-0000-0000-000000000005'],
    regulationLabels: ['一般の部'],
    freeText: null,
    customFieldValues: {},
    status: 'waitlisted',
    waitlistPosition: 2,
  },
];

describe('staff entries +page.svelte', () => {
  it('shows personal-name fields and the waitlist position', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: ENTRIES.length,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: null,
      },
    });

    expect(screen.getByText('山田太郎')).toBeInTheDocument();
    expect(screen.getByText('ヤマダタロウ')).toBeInTheDocument();
    // Scoped to the table: the status filter offers キャンセル待ち too.
    expect(
      within(screen.getByRole('table')).getByText(/キャンセル待ち/),
    ).toHaveTextContent('キャンセル待ち (2番目)');
  });

  it('links to the CSV export for this tournament', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: ENTRIES.length,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: null,
      },
    });

    expect(
      screen.getByRole('link', {name: 'CSV をダウンロード'}),
    ).toHaveAttribute(
      'href',
      `/api/staff/tournaments/${TOURNAMENT.id}/entries.csv`,
    );
  });

  it("opens this tournament's entry form in a new tab for checking it", () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: ENTRIES.length,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: null,
      },
    });

    const link = screen.getByRole('link', {
      name: 'エントリーフォームを確認(新しいタブで開きます)',
    });
    expect(link).toHaveAttribute('href', `/tokyo/${TOURNAMENT.type}/entry`);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('warns that the CSV is meant for spreadsheets, not re-import', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: ENTRIES.length,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: null,
      },
    });

    expect(
      screen.getByText(/他システムへの取り込みには使えません/),
    ).toBeInTheDocument();
  });

  it('links each row to its detail page', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: ENTRIES.length,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: null,
      },
    });

    const link = screen.getAllByRole('link', {name: '詳細'})[0];
    expect(link).toHaveAttribute(
      'href',
      `/staff/tokyo/saikyoi/entries/${ENTRIES[0].id}`,
    );
  });

  it('keeps the status filter in the pager links', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: 250,
          limit: 100,
          offset: 100,
          status: 'waitlisted',
        },
        form: null,
      },
    });

    expect(screen.getByText('250 件中 101〜200 件')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '次へ'})).toHaveAttribute(
      'href',
      '?status=waitlisted&offset=200',
    );
    expect(screen.getByRole('link', {name: '前へ'})).toHaveAttribute(
      'href',
      '?status=waitlisted',
    );
    expect(screen.getByRole('combobox', {name: 'ステータス'})).toHaveValue(
      'waitlisted',
    );
  });

  it('offers every status, and all of them, in the filter', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: [],
          total: 0,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: null,
      },
    });

    const select = screen.getByRole('combobox', {
      name: 'ステータス',
    });
    expect(select).toHaveValue('');
    expect(
      Array.from(select.querySelectorAll('option'), option => option.text),
    ).toEqual([
      'すべて',
      'メール確認待ち',
      '確定',
      'キャンセル待ち',
      'キャンセル',
    ]);
    expect(
      screen.getByText('該当するエントリーはありません。'),
    ).toBeInTheDocument();
  });
});
