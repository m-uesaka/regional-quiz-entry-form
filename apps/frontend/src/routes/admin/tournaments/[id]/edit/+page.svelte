<script lang="ts">
  import {untrack} from 'svelte';
  import {createApiClient} from '$lib/api';
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import SheetImportPanel from '$lib/components/SheetImportPanel.svelte';
  import type {TournamentType} from '@regional-quiz/shared';
  import type {TournamentFormValues} from '$lib/types/tournament-form';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();

  const api = createApiClient();

  let updated = $state(false);
  // `TournamentForm` lets staff change the tournament type, and the import
  // panel below embeds that type as the `tournamentSlug` of the generated
  // YAML. Track the type the server last confirmed instead of the one from
  // the initial page load, otherwise a saved type change would keep
  // generating the old slug and the upload API would reject it. `untrack`
  // documents that `data` only seeds this state once (and silences Svelte's
  // `state_referenced_locally` warning).
  let currentType = $state<TournamentType>(
    untrack(() => data.tournament.type),
  );

  async function handleUpdate(
    values: TournamentFormValues,
  ): Promise<string | null> {
    const res = await api.api.tournaments[':id'].$patch({
      param: {id: data.tournament.id},
      json: values,
    });
    const body = await res.json();
    if ('id' in body) {
      currentType = body.type;
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
  tournamentType={currentType}
/>
