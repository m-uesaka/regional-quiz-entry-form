import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';
import type {Region, StaffClaims, Tournament} from '@regional-quiz/shared';
import Page from './+page.svelte';
import type {PageProps} from './$types';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000011',
  type: 'saikyoi',
  name: '第1回テスト最強位',
  capacity: 64,
  entryOpensAt: '2026-01-01T00:00:00.000Z',
  entryClosesAt: '2026-02-01T00:00:00.000Z',
};

const REGIONS: Region[] = [
  {
    id: '00000000-0000-0000-0000-000000000011',
    slug: 'tokyo',
    name: '東京',
    allowsDualEntry: false,
  },
  {
    id: '00000000-0000-0000-0000-000000000022',
    slug: 'osaka',
    name: '大阪',
    allowsDualEntry: true,
  },
];

// Handed down by `routes/admin/+layout.server.ts`.
const STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-0000000000ff',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

/** A second tournament, reached by a link that only changes `[id]`. */
const OTHER_TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-0000000000ff',
  regionId: '00000000-0000-0000-0000-000000000022',
  type: 'shinjinou',
  name: '第2回テスト新人王',
  capacity: null,
  entryOpensAt: '2026-03-01T00:00:00.000Z',
  entryClosesAt: '2026-04-01T00:00:00.000Z',
};

function renderPage(
  tournament: Tournament = TOURNAMENT,
  form: PageProps['form'] = null,
) {
  return render(Page, {
    props: {
      params: {id: tournament.id},
      data: {staff: STAFF, tournament, regions: REGIONS},
      form,
    },
  });
}

describe('admin tournament edit +page.svelte', () => {
  it('prefills the form with the tournament being edited', () => {
    renderPage();

    expect(screen.getByLabelText('地域')).toHaveValue(TOURNAMENT.regionId);
    expect(screen.getByLabelText('大会名')).toHaveValue(TOURNAMENT.name);
    expect(screen.getByLabelText(/定員/)).toHaveValue(TOURNAMENT.capacity);
    expect(screen.getByLabelText('種別')).toHaveValue('saikyoi');
    expect(screen.getByText(/取り込み先: 最強位/)).toBeInTheDocument();
  });

  // The entry window is labelled JST, and is server-rendered by a Worker
  // whose own clock is UTC — so neither end may be read in whatever zone the
  // runtime happens to be set to.
  it('shows the entry window as its JST wall-clock time', () => {
    renderPage();

    // 2026-01-01T00:00Z and 2026-02-01T00:00Z, in JST.
    expect(screen.getByLabelText(/エントリー開始日時/)).toHaveValue(
      '2026-01-01T09:00',
    );
    expect(screen.getByLabelText(/エントリー終了日時/)).toHaveValue(
      '2026-02-01T09:00',
    );
  });

  // `/api/*` is only routed to the backend Worker for requests the frontend
  // makes itself, so a save sent from the browser 404s in production. The
  // form posts to the page's own `update` action instead.
  it('saves through the page action rather than from the browser', () => {
    renderPage();

    const form = screen
      .getByRole('button', {name: '更新'})
      .closest('form') as HTMLFormElement;
    expect(form).toHaveAttribute('method', 'POST');
    expect(form).toHaveAttribute('action', '?/update');
    expect(form.elements.namedItem('name')).toHaveValue(TOURNAMENT.name);
    expect(form.elements.namedItem('entryOpensAt')).toHaveValue(
      '2026-01-01T09:00',
    );
  });

  it('reports a saved update', () => {
    renderPage(TOURNAMENT, {saved: true, error: null, values: null});

    expect(screen.getByRole('status')).toHaveTextContent('更新しました');
  });

  it('re-renders what a refused save carried, with its message', () => {
    renderPage(TOURNAMENT, {
      saved: false,
      error: 'regionId が不正です',
      values: {
        regionId: REGIONS[1].id,
        type: 'shinjinou',
        name: '書きかけの大会名',
        capacity: '',
        entryOpensAt: '2026-01-01T09:00',
        entryClosesAt: '2026-02-01T09:00',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('regionId が不正です');
    expect(screen.getByLabelText('大会名')).toHaveValue('書きかけの大会名');
    expect(screen.getByLabelText('地域')).toHaveValue(REGIONS[1].id);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // The previewed YAML carries the tournament's type as its
  // `tournamentSlug`, and the API refuses an upload whose slug doesn't match
  // the target tournament — so the panel follows the type `load` last read
  // rather than the one the page was first rendered with.
  it('follows a saved type change in the import panel', async () => {
    const {rerender} = renderPage();
    expect(screen.getByText(/取り込み先: 最強位/)).toBeInTheDocument();

    await rerender({
      params: {id: TOURNAMENT.id},
      data: {
        staff: STAFF,
        tournament: {...TOURNAMENT, type: 'shinjinou'},
        regions: REGIONS,
      },
      form: {saved: true, error: null, values: null},
    });

    expect(screen.getByText(/取り込み先: 新人王/)).toBeInTheDocument();
  });

  // SvelteKit re-uses this page component across a navigation that only
  // changes the route parameters, so a move to another tournament has to
  // re-seed everything the first one left behind — otherwise the import
  // panel would file the first one's sheet under the second one's id.
  // See #98.
  it('re-seeds from the tournament the route moves to', async () => {
    const {rerender} = renderPage();

    await rerender({
      params: {id: OTHER_TOURNAMENT.id},
      data: {staff: STAFF, tournament: OTHER_TOURNAMENT, regions: REGIONS},
      form: null,
    });

    expect(screen.getByLabelText('大会名')).toHaveValue(OTHER_TOURNAMENT.name);
    expect(screen.getByLabelText('地域')).toHaveValue(
      OTHER_TOURNAMENT.regionId,
    );
    expect(screen.getByLabelText(/定員/)).toHaveValue(null);
    expect(screen.getByLabelText('種別')).toHaveValue('shinjinou');
    expect(screen.getByPlaceholderText('スプレッドシートID')).toHaveValue('');
    expect(screen.getByText(/取り込み先: 新人王/)).toBeInTheDocument();
  });
});
