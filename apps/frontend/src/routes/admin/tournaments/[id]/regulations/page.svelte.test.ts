import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {Regulation, StaffClaims} from '@regional-quiz/shared';
import Page from './+page.svelte';
import type {PageProps} from './$types';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000001';

// Handed down by `routes/admin/+layout.server.ts`.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

const GENERAL: Regulation = {
  id: '00000000-0000-0000-0000-000000000011',
  tournamentId: TOURNAMENT_ID,
  label: '一般の部',
  priorityStartsAt: null,
  priorityEndsAt: null,
  displayOrder: 0,
};

const STUDENT: Regulation = {
  id: '00000000-0000-0000-0000-000000000012',
  tournamentId: TOURNAMENT_ID,
  label: '学生の部',
  // 2026-04-01 09:00 JST.
  priorityStartsAt: '2026-04-01T00:00:00.000Z',
  priorityEndsAt: '2026-04-30T00:00:00.000Z',
  displayOrder: 1,
};

function renderPage(regulations: Regulation[], form: PageProps['form'] = null) {
  render(Page, {
    props: {
      params: {id: TOURNAMENT_ID},
      data: {staff: STAFF, regulations},
      form,
    },
  });
}

describe('admin regulations +page.svelte', () => {
  it('renders each stored regulation with its position pre-filled', () => {
    renderPage([GENERAL, STUDENT]);

    const labels = screen.getAllByLabelText('レギュレーション名');
    expect(labels.map(input => (input as HTMLInputElement).value)).toEqual([
      '一般の部',
      '学生の部',
      // The blank row that adds a regulation without any scripting.
      '',
    ]);
    expect(
      screen
        .getAllByLabelText('表示順')
        .map(input => (input as HTMLInputElement).value),
    ).toEqual(['1', '2', '3']);
  });

  it('shows a stored priority window as its JST wall-clock time', () => {
    renderPage([STUDENT]);

    expect(screen.getAllByLabelText(/優先期間の開始/)[0]).toHaveValue(
      '2026-04-01T09:00',
    );
    expect(screen.getAllByLabelText(/優先期間の終了/)[0]).toHaveValue(
      '2026-04-30T09:00',
    );
  });

  it('offers a delete box only for a regulation that has been saved', () => {
    renderPage([GENERAL]);

    // One saved row, one blank row, and only the saved one can be removed.
    expect(screen.getAllByLabelText('削除する')).toHaveLength(1);
  });

  it('re-renders what a refused save carried rather than the stored rows', () => {
    renderPage([GENERAL], {
      saved: false,
      error: 'エントリーに使われているレギュレーションは削除できません',
      rows: [
        {
          id: GENERAL.id,
          order: '1',
          label: '書き換えた名前',
          priorityStartsAt: '',
          priorityEndsAt: '',
          remove: true,
        },
      ],
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'エントリーに使われているレギュレーションは削除できません',
    );
    expect(screen.getAllByLabelText('レギュレーション名')[0]).toHaveValue(
      '書き換えた名前',
    );
    expect(screen.getByLabelText('削除する')).toBeChecked();
  });

  it('links back to the tournament it belongs to', () => {
    renderPage([GENERAL]);

    expect(
      screen.getByRole('link', {name: '大会の編集へ戻る'}),
    ).toHaveAttribute('href', `/admin/tournaments/${TOURNAMENT_ID}/edit`);
  });
});
