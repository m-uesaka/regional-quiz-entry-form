<script lang="ts">
  import {createApiClient} from '$lib/api';

  interface Props {
    tournamentId: string;
  }

  const {tournamentId}: Props = $props();

  const api = createApiClient();

  let spreadsheetId = $state('');
  let tournamentSlug = $state('');
  let previewYaml = $state<string | null>(null);
  let previewError = $state<string | null>(null);
  let previewing = $state(false);

  type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  let saveStatus = $state<SaveStatus>('idle');
  let saveError = $state<string | null>(null);

  async function handlePreview(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    previewing = true;
    previewError = null;
    previewYaml = null;
    saveStatus = 'idle';
    saveError = null;

    const res = await api.api['sheet-import'].preview.$post({
      json: {spreadsheetId, tournamentSlug},
    });
    // The union of possible response bodies also includes the
    // `@hono/zod-validator` default validation-failure shape (`{success:
    // false, error: ZodError}`), which structurally overlaps with the
    // `{error: string}` shape but has a non-string `error`. Narrow on the
    // actual field presence/type rather than `res.status` so this stays
    // type-safe either way.
    const body = await res.json();
    if ('yaml' in body) {
      previewYaml = body.yaml;
    } else if ('error' in body && typeof body.error === 'string') {
      previewError = body.error;
    } else {
      previewError = '入力内容を確認してください';
    }
    previewing = false;
  }

  async function handleSave(): Promise<void> {
    if (previewYaml === null) {
      return;
    }
    saveStatus = 'saving';
    saveError = null;

    const res = await api.api['form-definitions'][':tournamentId'].$put({
      param: {tournamentId},
      json: {yaml: previewYaml},
    });
    const body = await res.json();
    if ('ok' in body && body.ok) {
      saveStatus = 'saved';
    } else if ('error' in body && typeof body.error === 'string') {
      saveStatus = 'error';
      saveError = body.error;
    } else {
      saveStatus = 'error';
      saveError = '保存に失敗しました';
    }
  }
</script>

<section class="sheet-import-panel">
  <h2>スプレッドシート取り込み</h2>

  <form onsubmit={handlePreview}>
    <label>
      大会スラッグ
      <input
        type="text"
        bind:value={tournamentSlug}
        placeholder="大会スラッグ"
        required
      />
    </label>
    <label>
      スプレッドシートID
      <input
        type="text"
        bind:value={spreadsheetId}
        placeholder="スプレッドシートID"
        required
      />
    </label>
    <button type="submit" disabled={previewing}>YAMLプレビュー</button>
  </form>

  {#if previewError}
    <p class="sheet-import-error" role="alert">{previewError}</p>
  {/if}

  {#if previewYaml !== null}
    <pre>{previewYaml}</pre>
    <button
      type="button"
      onclick={handleSave}
      disabled={saveStatus === 'saving'}
    >
      保存
    </button>

    {#if saveStatus === 'saved'}
      <p class="sheet-import-success">保存しました</p>
    {:else if saveStatus === 'error' && saveError}
      <p class="sheet-import-error" role="alert">{saveError}</p>
    {/if}
  {/if}
</section>
