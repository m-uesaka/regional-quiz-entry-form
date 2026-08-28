import {render, screen} from '@testing-library/svelte';
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
    regulationId: '00000000-0000-0000-0000-000000000005',
    regulationLabel: '一般の部',
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
    regulationId: '00000000-0000-0000-0000-000000000005',
    regulationLabel: '一般の部',
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
        data: {loggedIn: true, tournament: TOURNAMENT, entries: ENTRIES},
        form: null,
      },
    });

    expect(screen.getByText('山田太郎')).toBeInTheDocument();
    expect(screen.getByText('ヤマダタロウ')).toBeInTheDocument();
    expect(screen.getByText(/キャンセル待ち/)).toHaveTextContent(
      'キャンセル待ち (2番目)',
    );
  });

  it('links to the CSV export for this tournament', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {loggedIn: true, tournament: TOURNAMENT, entries: ENTRIES},
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

  it('warns that the CSV is meant for spreadsheets, not re-import', () => {
    render(Page, {
      props: {
        params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
        data: {loggedIn: true, tournament: TOURNAMENT, entries: ENTRIES},
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
        data: {loggedIn: true, tournament: TOURNAMENT, entries: ENTRIES},
        form: null,
      },
    });

    const link = screen.getAllByRole('link', {name: '詳細'})[0];
    expect(link).toHaveAttribute(
      'href',
      `/staff/tokyo/saikyoi/entries/${ENTRIES[0].id}`,
    );
  });
});
