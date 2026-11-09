import type {BeforeNavigate, NavigationType} from '@sveltejs/kit';
import {render, screen} from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {jsonResponse} from '../../test-support/json-response';
import FormDefinitionEditor from './FormDefinitionEditor.svelte';

// The callbacks the editor registers, so a test can stand in for the router
// starting a navigation.
const navigationGuards = vi.hoisted(
  () => [] as Array<(navigation: BeforeNavigate) => void>,
);
vi.mock('$app/navigation', () => ({
  beforeNavigate: (callback: (navigation: BeforeNavigate) => void) => {
    navigationGuards.push(callback);
  },
}));

/**
 * Runs the registered guards over a navigation of the given type.
 * @param type How the navigation was started.
 * @return Whether a guard cancelled it.
 */
function navigate(type: Exclude<NavigationType, 'enter'>): boolean {
  let cancelled = false;
  const navigation = {
    type,
    willUnload: type === 'leave',
    cancel: () => {
      cancelled = true;
    },
  } as unknown as BeforeNavigate;
  for (const guard of navigationGuards) {
    guard(navigation);
  }
  return cancelled;
}

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000000';
const STORED_YAML = 'tournamentSlug: saikyoi\nfields: []\n';
const SHEET_YAML =
  'tournamentSlug: saikyoi\nfields:\n  - key: note\n    label: 備考\n    type: textarea\n    required: false\n';
const PROPS = {
  tournamentId: TOURNAMENT_ID,
  tournamentType: 'saikyoi',
  initialYaml: STORED_YAML,
} as const;

describe('FormDefinitionEditor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    navigationGuards.length = 0;
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
      screen.getByLabelText('スプレッドシート(URL または ID)'),
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

    await user.type(
      screen.getByLabelText('スプレッドシート(URL または ID)'),
      'bad',
    );
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
        screen.getByLabelText('スプレッドシート(URL または ID)'),
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

  // Leaving the page throws the draft away, as nothing but the stored text
  // comes back (#303).
  describe('leaving with an unsaved draft', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function editDraft(): Promise<void> {
      const user = userEvent.setup();
      render(FormDefinitionEditor, {props: PROPS});
      await user.type(screen.getByLabelText('YAML'), '# 手で直した');
    }

    it('lets the page go while the text is what is stored', () => {
      const confirm = vi.spyOn(window, 'confirm');
      render(FormDefinitionEditor, {props: PROPS});

      expect(navigate('link')).toBe(false);
      expect(navigate('leave')).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('stays when leaving is not confirmed', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await editDraft();

      expect(navigate('link')).toBe(true);
      expect(confirm).toHaveBeenCalledOnce();
      expect(navigate('popstate')).toBe(true);
    });

    it('goes once leaving is confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await editDraft();

      expect(navigate('link')).toBe(false);
    });

    // Reloading, closing the tab or leaving the site can only be held up by
    // the browser's own dialog, which cancelling asks for.
    it("leaves an unload to the browser's own dialog", async () => {
      const confirm = vi.spyOn(window, 'confirm');
      await editDraft();

      expect(navigate('leave')).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    // A form action's redirect: the tournament was deleted, or the session
    // is gone, and staying behind would keep nothing.
    it('lets a redirect through', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      await editDraft();

      expect(navigate('goto')).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    });

    it('lets the page go once the draft is saved', async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, 'confirm');
      fetchMock.mockResolvedValueOnce(jsonResponse({ok: true}));
      await editDraft();

      await user.click(screen.getByRole('button', {name: '保存'}));
      expect(await screen.findByText('保存しました')).toBeInTheDocument();

      expect(navigate('link')).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
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
  // What no navigation guard sees -- the error page a failed `load` re-run
  // shows in this page's place, a reload -- leaves the draft in the tab's
  // session storage for the next render to pick up (#338).
  describe('the draft kept for the tab', () => {
    const DRAFT_KEY = `form-definition-draft:${TOURNAMENT_ID}:saikyoi`;

    it('brings an unsaved draft back on the next render', async () => {
      const user = userEvent.setup();
      const first = render(FormDefinitionEditor, {props: PROPS});
      await user.type(screen.getByLabelText('YAML'), '# 手で直した');
      first.unmount();

      render(FormDefinitionEditor, {props: PROPS});

      expect(await screen.findByRole('status')).toHaveTextContent(
        '下書きを復元しました',
      );
      expect(screen.getByLabelText('YAML')).toHaveValue(
        `${STORED_YAML}# 手で直した`,
      );
    });

    it('puts the stored text back over a restored draft on request', async () => {
      const user = userEvent.setup();
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({base: STORED_YAML, yaml: 'tournamentSlug: saikyoi\n'}),
      );
      render(FormDefinitionEditor, {props: PROPS});

      await user.click(
        await screen.findByRole('button', {name: '保存済みの内容に戻す'}),
      );

      expect(screen.getByLabelText('YAML')).toHaveValue(STORED_YAML);
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('drops a draft typed over a definition saved since', async () => {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({base: 'tournamentSlug: saikyoi\n', yaml: '# 古い'}),
      );
      render(FormDefinitionEditor, {props: PROPS});
      await Promise.resolve();

      expect(screen.getByLabelText('YAML')).toHaveValue(STORED_YAML);
      expect(
        screen.queryByText(/下書きを復元しました/),
      ).not.toBeInTheDocument();
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('forgets the draft once it is saved', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(jsonResponse({ok: true}));
      render(FormDefinitionEditor, {props: PROPS});
      await user.type(screen.getByLabelText('YAML'), '# 手で直した');
      expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();

      await user.click(screen.getByRole('button', {name: '保存'}));
      await screen.findByText('保存しました');

      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('forgets the draft when the page is left on purpose', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
      render(FormDefinitionEditor, {props: PROPS});
      await user.type(screen.getByLabelText('YAML'), '# 手で直した');

      expect(navigate('link')).toBe(false);

      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    });
  });
});
