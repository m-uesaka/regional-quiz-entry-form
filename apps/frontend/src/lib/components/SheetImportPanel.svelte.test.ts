import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import SheetImportPanel from './SheetImportPanel.svelte';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

describe('SheetImportPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews YAML from the sheet-import endpoint and renders it', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({yaml: 'tournamentSlug: foo\n'}),
    );

    render(SheetImportPanel, {props: {tournamentId: TOURNAMENT_ID}});

    await user.type(screen.getByPlaceholderText('大会スラッグ'), 'foo');
    await user.type(
      screen.getByPlaceholderText('スプレッドシートID'),
      'sheet-123',
    );
    await user.click(screen.getByRole('button', {name: 'YAMLプレビュー'}));

    expect(await screen.findByText('tournamentSlug: foo')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sheet-import/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      spreadsheetId: 'sheet-123',
      tournamentSlug: 'foo',
    });
  });

  it('shows the error message when the preview request fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({error: 'invalid spreadsheet id'}, 400),
    );

    render(SheetImportPanel, {props: {tournamentId: TOURNAMENT_ID}});

    await user.type(screen.getByPlaceholderText('大会スラッグ'), 'foo');
    await user.type(
      screen.getByPlaceholderText('スプレッドシートID'),
      'bad-id',
    );
    await user.click(screen.getByRole('button', {name: 'YAMLプレビュー'}));

    expect(
      await screen.findByText('invalid spreadsheet id'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '保存'}),
    ).not.toBeInTheDocument();
  });

  it('saves the previewed YAML via the form-definitions endpoint', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({yaml: 'tournamentSlug: foo\n'}))
      .mockResolvedValueOnce(jsonResponse({ok: true}));

    render(SheetImportPanel, {props: {tournamentId: TOURNAMENT_ID}});

    await user.type(screen.getByPlaceholderText('大会スラッグ'), 'foo');
    await user.type(
      screen.getByPlaceholderText('スプレッドシートID'),
      'sheet-123',
    );
    await user.click(screen.getByRole('button', {name: 'YAMLプレビュー'}));
    await screen.findByText('tournamentSlug: foo');

    await user.click(screen.getByRole('button', {name: '保存'}));

    expect(await screen.findByText('保存しました')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/form-definitions/${TOURNAMENT_ID}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      yaml: 'tournamentSlug: foo\n',
    });
  });
});
