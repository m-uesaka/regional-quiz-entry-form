import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {StaffEntryDetail} from '@regional-quiz/shared';
import Page from './+page.svelte';

const ENTRY: StaffEntryDetail = {
  id: '00000000-0000-0000-0000-000000000004',
  tournamentId: '00000000-0000-0000-0000-000000000001',
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationId: '00000000-0000-0000-0000-000000000005',
  regulationLabel: '一般の部',
  freeText: '自由記述の本文です',
  customFieldValues: {
    t_shirt_size: 'L',
    allergies: ['卵', '乳'],
    agree_to_rules: ['agree_to_rules'],
  },
  status: 'waitlisted',
  waitlistPosition: 3,
  formFieldDefs: [
    {
      fieldKey: 't_shirt_size',
      label: 'Tシャツサイズ',
      fieldType: 'radio',
      required: true,
      options: ['S', 'M', 'L'],
      displayOrder: 0,
    },
    {
      fieldKey: 'allergies',
      label: 'アレルギー',
      fieldType: 'checkbox',
      required: false,
      options: ['卵', '乳', '小麦'],
      displayOrder: 1,
    },
    {
      fieldKey: 'agree_to_rules',
      label: '規約に同意する',
      fieldType: 'checkbox',
      required: true,
      options: null,
      displayOrder: 2,
    },
  ],
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

  it('renders each custom field under its label instead of its raw key', () => {
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

    expect(screen.getByText('Tシャツサイズ')).toBeInTheDocument();
    expect(screen.getByText('アレルギー')).toBeInTheDocument();
    expect(screen.queryByText('t_shirt_size')).not.toBeInTheDocument();
    expect(screen.queryByText('allergies')).not.toBeInTheDocument();
  });

  it('renders a human-readable value for a boolean checkbox field with no options', () => {
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

    expect(screen.getByText('規約に同意する')).toBeInTheDocument();
    expect(screen.getByText('はい')).toBeInTheDocument();
    expect(screen.queryByText('agree_to_rules')).not.toBeInTheDocument();
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
