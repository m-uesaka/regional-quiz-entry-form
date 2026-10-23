<script lang="ts">
  import {
    TOURNAMENT_TYPE_LABELS,
    type TournamentType,
  } from '@regional-quiz/shared';
  import {createApiClient} from '$lib/api';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';

  interface Props {
    tournamentId: string;
    tournamentType: TournamentType;
  }

  // The slug embedded in the generated YAML comes from the tournament being
  // edited rather than from a staff-typed field: the upload API rejects a
  // YAML whose `tournamentSlug` doesn't match the target tournament's type,
  // and a typo here would have meant a preview that can't be saved.
  const {tournamentId, tournamentType}: Props = $props();

  const api = createApiClient();

  let spreadsheetId = $state('');
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

    try {
      const res = await api.api['sheet-import'].preview.$post({
        json: {spreadsheetId, tournamentSlug: tournamentType},
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
    } catch (e: unknown) {
      previewError =
        e instanceof Error ? e.message : 'プレビューの取得に失敗しました';
    } finally {
      previewing = false;
    }
  }

  async function handleSave(): Promise<void> {
    if (previewYaml === null) {
      return;
    }
    saveStatus = 'saving';
    saveError = null;

    try {
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
    } catch (e: unknown) {
      saveStatus = 'error';
      saveError = e instanceof Error ? e.message : '保存に失敗しました';
    }
  }
</script>

<section>
  <Card class="gap-4">
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-bold">スプレッドシート取り込み</h2>

      <p class="text-sm text-muted-foreground">
        取り込み先: {TOURNAMENT_TYPE_LABELS[tournamentType]} ({tournamentType})
      </p>
    </div>

    <form onsubmit={handlePreview} class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label for="sheet-import-spreadsheet-id">スプレッドシートID</Label>
        <Input
          id="sheet-import-spreadsheet-id"
          class="w-full"
          type="text"
          bind:value={spreadsheetId}
          placeholder="スプレッドシートID"
          required
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={previewing}>
          YAMLプレビュー
        </Button>
      </div>
    </form>

    {#if previewError}
      <Message variant="danger">
        <p class="text-sm text-foreground" role="alert">{previewError}</p>
      </Message>
    {/if}

    {#if previewYaml !== null}
      <pre
        class="max-h-96 overflow-auto rounded-md border border-border bg-subtle p-4 font-mono text-xs leading-relaxed">{previewYaml}</pre>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          onclick={handleSave}
          disabled={saveStatus === 'saving'}
        >
          保存
        </Button>
      </div>

      {#if saveStatus === 'saved'}
        <Message variant="success">
          <p class="text-sm text-foreground">保存しました</p>
        </Message>
      {:else if saveStatus === 'error' && saveError}
        <Message variant="danger">
          <p class="text-sm text-foreground" role="alert">{saveError}</p>
        </Message>
      {/if}
    {/if}
  </Card>
</section>
