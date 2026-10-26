import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
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
  sessionsValidFrom: 1756085025678,
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
      imported: false,
      spreadsheetId: '',
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

  // A "表示順" typed into the trailing blank row sorts it away from the end,
  // so the echoed rows no longer finish with a blank one — and a page that
  // only appended when the last row was a saved one grew another junk row on
  // every retry.
  it('keeps a single blank row when a refused save echoes one back', () => {
    renderPage([GENERAL], {
      saved: false,
      imported: false,
      spreadsheetId: '',
      error: 'レギュレーション名を入力してください',
      rows: [
        {
          id: '',
          order: '1',
          label: '',
          priorityStartsAt: '',
          priorityEndsAt: '',
          remove: false,
        },
        {
          id: GENERAL.id,
          order: '2',
          label: '一般の部',
          priorityStartsAt: '',
          priorityEndsAt: '',
          remove: false,
        },
      ],
    });

    expect(
      screen
        .getAllByLabelText('レギュレーション名')
        .map(input => (input as HTMLInputElement).value),
    ).toEqual(['一般の部', '']);
  });

  it('links back to the tournament it belongs to', () => {
    renderPage([GENERAL]);

    expect(
      screen.getByRole('link', {name: '大会の編集へ戻る'}),
    ).toHaveAttribute('href', `/admin/tournaments/${TOURNAMENT_ID}/edit`);
  });

  it('offers to read the regulations from a spreadsheet', () => {
    renderPage([GENERAL]);

    expect(screen.getByLabelText('スプレッドシートID')).toHaveValue('');
    expect(
      screen.getByRole('button', {name: 'スプレッドシートから読み込む'}),
    ).toBeInTheDocument();
  });

  it('shows imported rows as unsaved, with the dropped ones ticked', () => {
    renderPage([GENERAL], {
      saved: false,
      imported: true,
      spreadsheetId: 'sheet-id',
      error: null,
      rows: [
        {
          id: '',
          order: '',
          label: '地元の部',
          priorityStartsAt: '2026-08-01T10:00',
          priorityEndsAt: '2026-08-08T10:00',
          remove: false,
        },
        {
          id: GENERAL.id,
          order: '',
          label: '一般の部',
          priorityStartsAt: '',
          priorityEndsAt: '',
          remove: true,
        },
      ],
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'まだ保存されていません',
    );
    expect(screen.getByLabelText('スプレッドシートID')).toHaveValue('sheet-id');
    expect(
      screen
        .getAllByLabelText('レギュレーション名')
        .map(input => (input as HTMLInputElement).value),
    ).toEqual(['地元の部', '一般の部', '']);
    expect(screen.getAllByLabelText(/優先期間の開始/)[0]).toHaveValue(
      '2026-08-01T10:00',
    );
    // Only the stored row can be removed, and the import ticked it.
    expect(screen.getByLabelText('削除する')).toBeChecked();
  });

  it('moves a row with the arrow buttons, keeping what was typed into it', async () => {
    const user = userEvent.setup();
    renderPage([GENERAL, STUDENT]);

    const student = screen.getAllByLabelText('レギュレーション名')[1];
    await user.clear(student);
    await user.type(student, '学生の部(改)');
    await user.click(screen.getByRole('button', {name: '学生の部を上へ移動'}));

    const labels = screen.getAllByLabelText('レギュレーション名');
    expect(labels.map(input => (input as HTMLInputElement).value)).toEqual([
      '学生の部(改)',
      '一般の部',
      '',
    ]);
    // Named for its new position, so the save reads it as the first row.
    expect(labels[0]).toHaveAttribute('name', 'regulations[0].label');
    expect(
      screen
        .getAllByLabelText('表示順')
        .map(input => (input as HTMLInputElement).value),
    ).toEqual(['1', '2', '3']);
  });

  it('renumbers an echoed order once a row is moved', async () => {
    const user = userEvent.setup();
    renderPage([GENERAL, STUDENT], {
      saved: false,
      imported: false,
      spreadsheetId: '',
      error: 'レギュレーション名を入力してください',
      rows: [
        {
          id: GENERAL.id,
          order: '5',
          label: '一般の部',
          priorityStartsAt: '',
          priorityEndsAt: '',
          remove: false,
        },
        {
          id: STUDENT.id,
          order: '9',
          label: '学生の部',
          priorityStartsAt: '',
          priorityEndsAt: '',
          remove: false,
        },
      ],
    });

    await user.click(screen.getByRole('button', {name: '学生の部を上へ移動'}));

    expect(
      screen
        .getAllByLabelText('表示順')
        .map(input => (input as HTMLInputElement).value),
    ).toEqual(['1', '2', '3']);
  });

  it('names the blank row by its position', () => {
    renderPage([GENERAL]);

    expect(
      screen.getByRole('button', {name: '2 番目のレギュレーションを上へ移動'}),
    ).toBeInTheDocument();
  });
});
