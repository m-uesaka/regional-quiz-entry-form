import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Region, StaffClaims, Tournament} from '@regional-quiz/shared';
import Page from './+page.svelte';

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
  type: 'saikyoi',
  name: '第2回テスト最強位',
  capacity: null,
  entryOpensAt: '2026-03-01T00:00:00.000Z',
  entryClosesAt: '2026-04-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function renderPage(tournament: Tournament = TOURNAMENT) {
  return render(Page, {
    props: {
      params: {id: tournament.id},
      data: {staff: STAFF, tournament, regions: REGIONS},
      form: null,
    },
  });
}

describe('admin tournament edit +page.svelte', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('files an edited entry window as the instant that JST names', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(TOURNAMENT));

    renderPage();
    await user.clear(screen.getByLabelText(/エントリー開始日時/));
    await user.type(
      screen.getByLabelText(/エントリー開始日時/),
      '2026-01-05T10:30',
    );
    await user.click(screen.getByRole('button', {name: '更新'}));

    await screen.findByText('更新しました');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      entryOpensAt: '2026-01-05T01:30:00.000Z',
      entryClosesAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('sends the update to the tournament being edited', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({...TOURNAMENT, name: '改題した最強位'}),
    );

    renderPage();
    await user.clear(screen.getByLabelText('大会名'));
    await user.type(screen.getByLabelText('大会名'), '改題した最強位');
    await user.click(screen.getByRole('button', {name: '更新'}));

    expect(await screen.findByText('更新しました')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/tournaments/${TOURNAMENT.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: '改題した最強位',
      type: 'saikyoi',
    });
  });

  it('follows a saved type change in the import panel', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({...TOURNAMENT, type: 'shinjinou'}),
    );

    renderPage();
    await user.selectOptions(screen.getByLabelText('種別'), 'shinjinou');
    await user.click(screen.getByRole('button', {name: '更新'}));

    expect(await screen.findByText(/取り込み先: 新人王/)).toBeInTheDocument();
  });

  it('retracts the update notice when a later save fails', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(TOURNAMENT))
      .mockResolvedValueOnce(jsonResponse({error: 'regionId が不正です'}, 400));

    renderPage();
    await user.click(screen.getByRole('button', {name: '更新'}));
    await screen.findByText('更新しました');

    await user.selectOptions(screen.getByLabelText('地域'), REGIONS[1].id);
    await user.click(screen.getByRole('button', {name: '更新'}));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'regionId が不正です',
    );
    expect(screen.queryByText('更新しました')).not.toBeInTheDocument();
  });

  // The previewed YAML carries the type it was fetched with as its
  // `tournamentSlug`, and the API refuses an upload whose slug doesn't match
  // the target tournament — so a preview that outlived the type it was built
  // for is one the panel can no longer save.
  it('drops a preview built for the type a save replaced', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({yaml: 'tournamentSlug: saikyoi\n'}))
      .mockResolvedValueOnce(jsonResponse({...TOURNAMENT, type: 'shinjinou'}));

    renderPage();
    await user.type(
      screen.getByPlaceholderText('スプレッドシートID'),
      'sheet-123',
    );
    await user.click(screen.getByRole('button', {name: 'YAMLプレビュー'}));
    await screen.findByText('tournamentSlug: saikyoi');

    await user.selectOptions(screen.getByLabelText('種別'), 'shinjinou');
    await user.click(screen.getByRole('button', {name: '更新'}));
    await screen.findByText(/取り込み先: 新人王/);

    expect(
      screen.queryByText('tournamentSlug: saikyoi'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '保存'}),
    ).not.toBeInTheDocument();
  });

  // SvelteKit re-uses this page component across a navigation that only
  // changes the route parameters, so a move to another tournament has to
  // re-seed everything the first one left behind — otherwise saving would
  // write the first tournament's details to the second one, and the import
  // panel would file the first one's sheet under the second one's id.
  // See #98.
  it('re-seeds from the tournament the route moves to', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({...TOURNAMENT, type: 'shinjinou'}),
    );

    const {rerender} = renderPage();
    await user.clear(screen.getByLabelText('大会名'));
    await user.type(screen.getByLabelText('大会名'), '書きかけの大会名');
    await user.selectOptions(screen.getByLabelText('種別'), 'shinjinou');
    await user.type(
      screen.getByPlaceholderText('スプレッドシートID'),
      'sheet-123',
    );
    // Leaves behind the "更新しました" notice and a confirmed type that no
    // longer matches what the next tournament's `data` says.
    await user.click(screen.getByRole('button', {name: '更新'}));
    await screen.findByText('更新しました');

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
    expect(screen.getByLabelText('種別')).toHaveValue('saikyoi');
    expect(screen.getByPlaceholderText('スプレッドシートID')).toHaveValue('');
    expect(screen.queryByText('更新しました')).not.toBeInTheDocument();
    expect(screen.getByText(/取り込み先: 最強位/)).toBeInTheDocument();
  });
});
