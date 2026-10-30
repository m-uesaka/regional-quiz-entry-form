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
  entriesPaused: false,
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

describe('staff entries +page.svelte, pausing entries', () => {
  function renderWith(
    tournament: typeof TOURNAMENT,
    form: Record<string, unknown> | null = null,
  ) {
    return render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament,
          entries: ENTRIES,
          total: ENTRIES.length,
          limit: 100,
          offset: 0,
          status: null,
        },
        form: form as never,
      },
    });
  }

  it('offers to pause a tournament taking entries, through the page action', () => {
    renderWith(TOURNAMENT);

    const button = screen.getByRole('button', {
      name: 'エントリー受付を一時中断する',
    });
    const form = button.closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', '?/pause');
    expect(form.querySelector('input[name="paused"]')).toHaveValue('true');
    expect(form.querySelector('input[name="tournamentId"]')).toHaveValue(
      TOURNAMENT.id,
    );
  });

  it("keeps the list's filter and page across the action", () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {
          loggedIn: true,
          isGeneralStaff: false,
          tournament: TOURNAMENT,
          entries: ENTRIES,
          total: 300,
          limit: 100,
          offset: 100,
          status: 'confirmed',
        },
        form: null,
      },
    });

    expect(
      screen
        .getByRole('button', {name: 'エントリー受付を一時中断する'})
        .closest('form'),
    ).toHaveAttribute('action', '?status=confirmed&offset=100&/pause');
  });

  it('offers to resume a paused tournament, saying it is paused', () => {
    renderWith({...TOURNAMENT, entriesPaused: true});

    expect(screen.getByText('一時中断中')).toBeInTheDocument();
    const button = screen.getByRole('button', {
      name: 'エントリー受付を再開する',
    });
    expect(
      (button.closest('form') as HTMLFormElement).querySelector(
        'input[name="paused"]',
      ),
    ).toHaveValue('false');
  });

  it('reports what the action did', () => {
    renderWith(
      {...TOURNAMENT, entriesPaused: true},
      {paused: true, pauseError: null},
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'エントリー受付を一時中断しました',
    );
  });

  it('shows why the action was refused', () => {
    renderWith(TOURNAMENT, {
      paused: null,
      pauseError: 'この大会のエントリー受付を操作する権限がありません',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'この大会のエントリー受付を操作する権限がありません',
    );
  });
});
