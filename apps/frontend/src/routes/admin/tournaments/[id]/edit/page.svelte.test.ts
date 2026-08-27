import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Tournament} from '@regional-quiz/shared';
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
    props: {params: {id: tournament.id}, data: {tournament}},
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

    expect(screen.getByLabelText(/地域ID/)).toHaveValue(TOURNAMENT.regionId);
    expect(screen.getByLabelText('大会名')).toHaveValue(TOURNAMENT.name);
    expect(screen.getByLabelText(/定員/)).toHaveValue(TOURNAMENT.capacity);
    expect(screen.getByLabelText('種別')).toHaveValue('saikyoi');
    expect(screen.getByText(/取り込み先: 最強位/)).toBeInTheDocument();
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
      data: {tournament: OTHER_TOURNAMENT},
    });

    expect(screen.getByLabelText('大会名')).toHaveValue(OTHER_TOURNAMENT.name);
    expect(screen.getByLabelText(/地域ID/)).toHaveValue(
      OTHER_TOURNAMENT.regionId,
    );
    expect(screen.getByLabelText(/定員/)).toHaveValue(null);
    expect(screen.getByLabelText('種別')).toHaveValue('saikyoi');
    expect(screen.getByPlaceholderText('スプレッドシートID')).toHaveValue('');
    expect(screen.queryByText('更新しました')).not.toBeInTheDocument();
    expect(screen.getByText(/取り込み先: 最強位/)).toBeInTheDocument();
  });
});
