<!--
@component
A tournament's form definition as editable YAML, with two ways to change
it: edit the text directly, or reload it from the Google spreadsheet it was
written in. Either way nothing is stored until 保存 sends the text as it
stands, so a reloaded sheet can be checked (and touched up) first.
-->
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
  import Textarea from '$lib/components/ui/atoms/Textarea.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';

  interface Props {
    tournamentId: string;
    // The slug a reloaded sheet's YAML carries comes from the tournament
    // being edited rather than from a staff-typed field: the upload API
    // rejects a YAML whose `tournamentSlug` doesn't match the target
    // tournament's type, and a typo here would have meant YAML that can't
    // be saved.
    tournamentType: TournamentType;
    /** The stored definition, written out as YAML, to start editing from. */
    initialYaml: string;
  }

  const {tournamentId, tournamentType, initialYaml}: Props = $props();

  const api = createApiClient();

  // Seeded once: after that the text is the staff member's draft, and a
  // `load` re-run (say, after the tournament form above is saved) must not
  // throw it away. The page keys this component on the tournament and its
  // type, which is when a fresh start is wanted.
  // svelte-ignore state_referenced_locally
  let yaml = $state(initialYaml);

  let spreadsheetId = $state('');
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let loaded = $state(false);

  type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  let saveStatus = $state<SaveStatus>('idle');
  let saveError = $state<string | null>(null);

  async function handleLoadSheet(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    loading = true;
    loadError = null;
    loaded = false;
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
        yaml = body.yaml;
        loaded = true;
      } else if ('error' in body && typeof body.error === 'string') {
        loadError = body.error;
      } else {
        loadError = '入力内容を確認してください';
      }
    } catch (e: unknown) {
      loadError =
        e instanceof Error ? e.message : 'スプレッドシートの読み込みに失敗しました';
    } finally {
      loading = false;
    }
  }

  async function handleSave(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saveStatus = 'saving';
    saveError = null;
    loaded = false;

    try {
      const res = await api.api['form-definitions'][':tournamentId'].$put({
        param: {tournamentId},
        json: {yaml},
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

<Card class="gap-4">
  <div class="flex flex-col gap-1">
    <h2 class="text-lg font-bold">フォーム定義</h2>
    <p class="text-sm text-muted-foreground">
      対象: {TOURNAMENT_TYPE_LABELS[tournamentType]} ({tournamentType})
    </p>
  </div>

  <form onsubmit={handleLoadSheet} class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <Label for="form-definition-spreadsheet-id">スプレッドシートID</Label>
      <Input
        id="form-definition-spreadsheet-id"
        class="w-full"
        type="text"
        bind:value={spreadsheetId}
        placeholder="スプレッドシートID"
        required
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <Button type="submit" variant="secondary" disabled={loading}>
        スプレッドシートから読み込む
      </Button>
    </div>
  </form>

  {#if loadError}
    <Message variant="danger">
      <p class="text-sm text-foreground" role="alert">{loadError}</p>
    </Message>
  {/if}
  {#if loaded}
    <Message variant="default">
      <p class="text-sm text-foreground" role="status">
        スプレッドシートの内容を読み込みました。確認してから保存してください
      </p>
    </Message>
  {/if}

  <form onsubmit={handleSave} class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <Label for="form-definition-yaml">YAML</Label>
      <Textarea
        id="form-definition-yaml"
        class="w-full font-mono text-xs leading-relaxed"
        rows={16}
        spellcheck="false"
        bind:value={yaml}
      />
    </div>
    <div class="flex flex-wrap gap-2">
      <Button type="submit" disabled={saveStatus === 'saving'}>保存</Button>
    </div>
  </form>

  {#if saveStatus === 'saved'}
    <Message variant="success">
      <p class="text-sm text-foreground" role="status">保存しました</p>
    </Message>
  {:else if saveStatus === 'error' && saveError}
    <Message variant="danger">
      <p class="text-sm text-foreground" role="alert">{saveError}</p>
    </Message>
  {/if}
</Card>
