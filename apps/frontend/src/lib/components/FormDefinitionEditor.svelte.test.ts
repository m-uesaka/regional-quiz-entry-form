import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import FormDefinitionEditor from './FormDefinitionEditor.svelte';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000000';
const STORED_YAML = 'tournamentSlug: saikyoi\nfields: []\n';
const SHEET_YAML =
  'tournamentSlug: saikyoi\nfields:\n  - key: note\n    label: 備考\n    type: textarea\n    required: false\n';
const PROPS = {
  tournamentId: TOURNAMENT_ID,
  tournamentType: 'saikyoi',
  initialYaml: STORED_YAML,
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

describe('FormDefinitionEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts from the stored definition', () => {
    render(FormDefinitionEditor, {props: PROPS});

    expect(screen.getByLabelText('YAML')).toHaveValue(STORED_YAML);
    expect(screen.getByText(/対象: 最強位/)).toBeInTheDocument();
  });

  it('saves the YAML as edited by hand', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ok: true}));
    render(FormDefinitionEditor, {props: PROPS});

    const textarea = screen.getByLabelText('YAML');
    await user.clear(textarea);
    // `{` starts a key descriptor in user-event, so the brackets are typed
    // doubled.
    await user.type(textarea, 'tournamentSlug: saikyoi\nfields: [[]');
    await user.click(screen.getByRole('button', {name: '保存'}));

    expect(await screen.findByText('保存しました')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/form-definitions/${TOURNAMENT_ID}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      yaml: 'tournamentSlug: saikyoi\nfields: []',
    });
  });

  it('reloads the YAML from the spreadsheet without saving it yet', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({yaml: SHEET_YAML}));
    render(FormDefinitionEditor, {props: PROPS});

    await user.type(
      screen.getByPlaceholderText('スプレッドシートID'),
      'sheet-123',
    );
    await user.click(
      screen.getByRole('button', {name: 'スプレッドシートから読み込む'}),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      '確認してから保存してください',
    );
    expect(screen.getByLabelText('YAML')).toHaveValue(SHEET_YAML);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sheet-import/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      spreadsheetId: 'sheet-123',
      tournamentSlug: 'saikyoi',
    });
  });

  it('keeps the draft when the spreadsheet cannot be read', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({error: 'invalid spreadsheet id'}, 400),
    );
    render(FormDefinitionEditor, {props: PROPS});

    await user.type(screen.getByPlaceholderText('スプレッドシートID'), 'bad');
    await user.click(
      screen.getByRole('button', {name: 'スプレッドシートから読み込む'}),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'invalid spreadsheet id',
    );
    expect(screen.getByLabelText('YAML')).toHaveValue(STORED_YAML);
  });

  it('drops 保存しました once the saved text is edited again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse({ok: true}));
    render(FormDefinitionEditor, {props: PROPS});

    await user.click(screen.getByRole('button', {name: '保存'}));
    expect(await screen.findByText('保存しました')).toBeInTheDocument();
    await user.type(screen.getByLabelText('YAML'), '# 追記');

    expect(screen.queryByText('保存しました')).not.toBeInTheDocument();
  });

  // A reload replaces the whole text, with no undo.
  describe('reloading over unsaved hand edits', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function editThenReload(): Promise<void> {
      const user = userEvent.setup();
      render(FormDefinitionEditor, {props: PROPS});
      await user.type(screen.getByLabelText('YAML'), '# 手で直した');
      await user.type(
        screen.getByPlaceholderText('スプレッドシートID'),
        'sheet-123',
      );
      await user.click(
        screen.getByRole('button', {name: 'スプレッドシートから読み込む'}),
      );
    }

    it('keeps the edits when the reload is not confirmed', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

      await editThenReload();

      expect(confirm).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText('YAML')).toHaveValue(
        `${STORED_YAML}# 手で直した`,
      );
    });

    it('replaces them once the reload is confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      fetchMock.mockResolvedValueOnce(jsonResponse({yaml: SHEET_YAML}));

      await editThenReload();

      expect(await screen.findByRole('status')).toHaveTextContent(
        '確認してから保存してください',
      );
      expect(screen.getByLabelText('YAML')).toHaveValue(SHEET_YAML);
    });
  });

  it("shows the API's refusal of the YAML", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error:
            'YAML の tournamentSlug (shinjinou) が保存先の大会の種別 (saikyoi) と一致しません',
        },
        400,
      ),
    );
    render(FormDefinitionEditor, {props: PROPS});

    await user.click(screen.getByRole('button', {name: '保存'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('一致しません');
  });
});
