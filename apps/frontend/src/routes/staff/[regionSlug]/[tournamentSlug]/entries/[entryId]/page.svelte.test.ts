import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {Entry} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRY: Entry = {
  id: '00000000-0000-0000-0000-000000000004',
  tournamentId: '00000000-0000-0000-0000-000000000001',
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationId: '00000000-0000-0000-0000-000000000005',
  regulationLabel: '一般の部',
  freeText: '自由記述の本文です',
  customFieldValues: {t_shirt_size: 'L', allergies: ['卵', '乳']},
  status: 'waitlisted',
  waitlistPosition: 3,
};

describe('staff entry detail +page.svelte', () => {
  it('shows the entry’s personal fields, status, and free text', () => {
    render(Page, {
      props: {
        params: {
          regionSlug: 'tokyo',
          tournamentSlug: 'saikyoi',
          entryId: ENTRY.id,
        },
        data: {entry: ENTRY},
        form: null,
      },
    });

    expect(screen.getByText('山田太郎')).toBeInTheDocument();
    expect(screen.getByText('ヤマダタロウ')).toBeInTheDocument();
    expect(screen.getByText('taro@example.com')).toBeInTheDocument();
    expect(screen.getByText('一般の部')).toBeInTheDocument();
    expect(screen.getByText(/キャンセル待ち/)).toHaveTextContent(
      'キャンセル待ち (3番目)',
    );
    expect(screen.getByText('自由記述の本文です')).toBeInTheDocument();
  });

  it('joins multi-select custom field values with a Japanese comma', () => {
    render(Page, {
      props: {
        params: {
          regionSlug: 'tokyo',
          tournamentSlug: 'saikyoi',
          entryId: ENTRY.id,
        },
        data: {entry: ENTRY},
        form: null,
      },
    });

    expect(screen.getByText('卵、乳')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('links back to the entries list', () => {
    render(Page, {
      props: {
        params: {
          regionSlug: 'tokyo',
          tournamentSlug: 'saikyoi',
          entryId: ENTRY.id,
        },
        data: {entry: ENTRY},
        form: null,
      },
    });

    expect(screen.getByRole('link', {name: /一覧へ戻る/})).toHaveAttribute(
      'href',
      '/staff/tokyo/saikyoi/entries',
    );
  });
});
