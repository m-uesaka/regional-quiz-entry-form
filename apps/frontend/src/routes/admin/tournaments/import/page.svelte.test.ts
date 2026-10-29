import type {ComponentProps} from 'svelte';
import {fireEvent, render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {
  StaffClaims,
  TournamentImportPreviewRow,
  TournamentImportResult,
} from '@regional-quiz/shared';
import Page from './+page.svelte';

type PageForm = ComponentProps<typeof Page>['form'];

const CREATED: TournamentImportResult = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  outcome: 'created',
  tournamentId: '00000000-0000-0000-0000-000000000021',
  type: 'saikyoi',
  capacity: 54,
  entryOpensAt: '2026-11-04T12:00:00.000Z',
  entryClosesAt: '2026-12-16T14:59:59.000Z',
  error: null,
};

const UPDATED: TournamentImportResult = {
  ...CREATED,
  row: 3,
  typeLabel: '新人王',
  outcome: 'updated',
  tournamentId: '00000000-0000-0000-0000-000000000022',
  type: 'shinjinou',
};

const FAILED: TournamentImportResult = {
  row: 4,
  regionName: '宮崎＆鹿児島',
  typeLabel: '宮崎',
  outcome: 'failed',
  tournamentId: null,
  type: null,
  capacity: null,
  entryOpensAt: null,
  entryClosesAt: null,
  error: '種別「宮崎」は最強位・新人王のいずれでもありません',
};

const NEW_ROW: TournamentImportPreviewRow = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  action: 'create',
  error: null,
  capacity: 54,
  entryOpensAt: '2026-11-04T12:00:00.000Z',
  entryClosesAt: '2026-12-16T14:59:59.000Z',
  formFieldLabels: ['備考'],
  regulationLabels: ['一般'],
  current: null,
};

const OVERWRITE_ROW: TournamentImportPreviewRow = {
  ...NEW_ROW,
  row: 3,
  typeLabel: '新人王',
  action: 'overwrite',
  capacity: 36,
  current: {
    tournamentId: '00000000-0000-0000-0000-000000000022',
    name: '北海道新人王',
    capacity: 30,
    entryOpensAt: '2026-11-04T12:00:00.000Z',
    entryClosesAt: '2026-12-16T14:59:59.000Z',
  },
};

const INVALID_ROW: TournamentImportPreviewRow = {
  ...NEW_ROW,
  row: 4,
  regionName: '宮崎＆鹿児島',
  typeLabel: '宮崎',
  action: null,
  error: '種別「宮崎」は最強位・新人王のいずれでもありません',
  capacity: null,
  entryOpensAt: null,
  entryClosesAt: null,
  formFieldLabels: [],
  regulationLabels: [],
};

// Handed down by `routes/admin/+layout.server.ts`.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

function renderPage(form: PageForm = null) {
  render(Page, {props: {params: {}, data: {staff: STAFF}, form}});
}

describe('admin tournament import +page.svelte', () => {
  it('asks for the 大会一覧 spreadsheet', () => {
    renderPage();

    expect(
      screen.getByLabelText('大会一覧のスプレッドシート(URL または ID)'),
    ).toBeRequired();
    expect(screen.getByRole('button', {name: '読み込む'})).toBeInTheDocument();
  });

  it('frees the button again when the page is shown again', async () => {
    renderPage();
    const form = screen
      .getByRole('button', {name: '読み込む'})
      .closest('form') as HTMLFormElement;
    // The test environment doesn't submit, so the handler's effect is all
    // that is observed.
    form.addEventListener('submit', event => event.preventDefault());

    await fireEvent.submit(form);
    expect(screen.getByRole('button', {name: '読み込み中…'})).toBeDisabled();

    await fireEvent(window, new Event('pageshow'));
    expect(screen.getByRole('button', {name: '読み込む'})).toBeEnabled();
  });

  it('sums up the outcome and lists the rows that failed with why', () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: null,
      rows: null,
      results: [CREATED, UPDATED, FAILED],
    } as PageForm);

    expect(screen.getByRole('status')).toHaveTextContent(
      '2件を登録しました(新規 1件・上書き 1件)。1件はエラーのため登録していません。',
    );
    const failedTable = screen.getByRole('heading', {
      name: '登録できなかった大会',
    }).nextElementSibling as HTMLElement;
    expect(
      within(failedTable).getByText(FAILED.error as string),
    ).toBeInTheDocument();
    expect(within(failedTable).queryByText('北海道')).toBeNull();
  });

  it('links each registered tournament to its edit screen', () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: null,
      rows: null,
      results: [CREATED],
    } as PageForm);

    expect(
      screen.getByRole('link', {name: /^編集\s*\(北海道最強位\)$/}),
    ).toHaveAttribute(
      'href',
      `/admin/tournaments/${CREATED.tournamentId}/edit`,
    );
    expect(
      screen.queryByRole('heading', {name: '登録できなかった大会'}),
    ).toBeNull();
  });

  it('shows why nothing was registered and keeps what was pasted', () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: '1行目に「地域」の列が見つかりません',
      rows: null,
      results: null,
    } as PageForm);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '1行目に「地域」の列が見つかりません',
    );
    expect(
      screen.getByLabelText('大会一覧のスプレッドシート(URL または ID)'),
    ).toHaveValue('abc123');
    expect(screen.queryByRole('heading', {name: '結果'})).toBeNull();
  });

  it('offers each registrable tournament, choosing only the new ones', () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: null,
      rows: [NEW_ROW, OVERWRITE_ROW, INVALID_ROW],
      results: null,
    } as PageForm);

    const create = screen.getByRole('checkbox', {
      name: '北海道最強位を新規作成する',
    });
    const overwrite = screen.getByRole('checkbox', {
      name: '北海道新人王を上書きする',
    });
    expect(create).toBeChecked();
    expect(overwrite).not.toBeChecked();
    // What an overwrite would change.
    expect(screen.getByText('現在: 30名')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: '選択した1件を登録する'}),
    ).toBeEnabled();
    expect(screen.getByText(INVALID_ROW.error as string)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', {name: /宮崎/})).toBeNull();
  });

  it('chooses all, or none, at once', async () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: null,
      rows: [NEW_ROW, OVERWRITE_ROW],
      results: null,
    } as PageForm);

    await fireEvent.click(screen.getByRole('button', {name: 'すべて選択'}));
    expect(
      screen.getByRole('checkbox', {name: '北海道新人王を上書きする'}),
    ).toBeChecked();
    expect(
      screen.getByRole('button', {name: '選択した2件を登録する'}),
    ).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', {name: '選択を解除'}));
    expect(
      screen.getByRole('button', {name: '選択した0件を登録する'}),
    ).toBeDisabled();
  });

  it('posts what was chosen for the sheet that was read', () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: null,
      rows: [NEW_ROW],
      results: null,
    } as PageForm);

    const form = screen
      .getByRole('button', {name: '選択した1件を登録する'})
      .closest('form') as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get('spreadsheetId')).toBe('abc123');
    expect(data.getAll('selection').map(v => JSON.parse(String(v)))).toEqual([
      {regionName: '北海道', typeLabel: '最強位', action: 'create'},
    ]);
  });
});
