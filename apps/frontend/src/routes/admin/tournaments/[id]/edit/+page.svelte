<script lang="ts">
  import {createApiClient} from '$lib/api';
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import SheetImportPanel from '$lib/components/SheetImportPanel.svelte';
  import type {TournamentFormValues} from '$lib/types/tournament-form';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();

  const api = createApiClient();

  let updated = $state(false);

  async function handleUpdate(
    values: TournamentFormValues,
  ): Promise<string | null> {
    const res = await api.api.tournaments[':id'].$patch({
      param: {id: data.tournament.id},
      json: values,
    });
    const body = await res.json();
    if ('id' in body) {
      updated = true;
      return null;
    }
    if ('error' in body && typeof body.error === 'string') {
      return body.error;
    }
    return '入力内容を確認してください';
  }
</script>

<h1>大会を編集</h1>

<TournamentForm
  submitLabel="更新"
  initialValues={data.tournament}
  onSubmit={handleUpdate}
/>

{#if updated}
  <p>更新しました</p>
{/if}

<h2>フォーム定義の取り込み</h2>
<SheetImportPanel
  tournamentId={data.tournament.id}
  tournamentType={data.tournament.type}
/>
