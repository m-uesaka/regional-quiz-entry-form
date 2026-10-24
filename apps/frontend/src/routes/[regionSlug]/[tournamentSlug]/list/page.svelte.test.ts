import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {EntryListItem} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRIES: EntryListItem[] = [
  {displayName: '参加者A', status: 'confirmed', waitlistPosition: null},
  {displayName: '参加者B', status: 'waitlisted', waitlistPosition: 2},
];

describe('list +page.svelte', () => {
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
    expect(screen.queryByRole('list')).toBeNull();
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
});
