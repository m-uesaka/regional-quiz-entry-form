<script lang="ts">
  import {createApiClient} from '$lib/api';
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import SheetImportPanel from '$lib/components/SheetImportPanel.svelte';
  import type {TournamentFormValues} from '$lib/types/tournament-form';

  const api = createApiClient();

  let tournamentId = $state<string | null>(null);

  async function handleCreate(
    values: TournamentFormValues,
  ): Promise<string | null> {
    const res = await api.api.tournaments.$post({json: values});
    const body = await res.json();
    if ('id' in body) {
      tournamentId = body.id;
      return null;
    }
    if ('error' in body && typeof body.error === 'string') {
      return body.error;
    }
    return '入力内容を確認してください';
  }
</script>

<h1>大会を作成</h1>

<TournamentForm submitLabel="作成" onSubmit={handleCreate} />

{#if tournamentId}
  <h2>フォーム定義の取り込み</h2>
  <SheetImportPanel tournamentId={tournamentId} />
{/if}
