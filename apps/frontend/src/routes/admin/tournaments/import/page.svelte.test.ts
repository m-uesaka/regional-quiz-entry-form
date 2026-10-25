import type {ComponentProps} from 'svelte';
import {render, screen, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {StaffClaims, TournamentImportResult} from '@regional-quiz/shared';
import Page from './+page.svelte';

type PageForm = ComponentProps<typeof Page>['form'];

const CREATED: TournamentImportResult = {
  row: 2,
  regionName: '北海道',
  typeLabel: '最強位',
  outcome: 'created',
  tournamentId: '00000000-0000-0000-0000-000000000021',
  type: 'saikyoi',
  entryOpensAt: '2026-11-01T00:00:00.000Z',
  entryClosesAt: '2026-12-25T14:59:00.000Z',
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
  entryOpensAt: null,
  entryClosesAt: null,
  error: '種別「宮崎」は最強位・新人王のいずれでもありません',
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
    expect(
      screen.getByRole('button', {name: '一括登録する'}),
    ).toBeInTheDocument();
  });

  it('sums up the outcome and lists the rows that failed with why', () => {
    renderPage({
      spreadsheetId: 'abc123',
      error: null,
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
});
