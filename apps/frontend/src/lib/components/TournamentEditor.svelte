<script lang="ts">
  import {untrack} from 'svelte';
  import {createApiClient} from '$lib/api';
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import SheetImportPanel from '$lib/components/SheetImportPanel.svelte';
  import type {Tournament, TournamentType} from '@regional-quiz/shared';
  import type {TournamentFormValues} from '$lib/types/tournament-form';

  interface Props {
    tournament: Tournament;
  }

  // Everything below is seeded from this once and owned from then on, so a
  // move to another tournament has to build this component afresh rather
  // than hand it a new prop. That is the caller's job: SvelteKit keeps a
  // page component across a navigation that changes only the route
  // parameters, so the page wraps this in `{#key data.tournament.id}`.
  // See #98.
  const {tournament}: Props = $props();

  const api = createApiClient();

  let updated = $state(false);
  // `TournamentForm` lets staff change the tournament type, and the import
  // panel below embeds that type as the `tournamentSlug` of the generated
  // YAML. Track the type the server last confirmed instead of the one from
  // the initial page load, otherwise a saved type change would keep
  // generating the old slug and the upload API would reject it. `untrack`
  // documents that `tournament` only seeds this state once (and silences
  // Svelte's `state_referenced_locally` warning).
  let currentType = $state<TournamentType>(untrack(() => tournament.type));

  async function handleUpdate(
    values: TournamentFormValues,
  ): Promise<string | null> {
    const res = await api.api.tournaments[':id'].$patch({
      param: {id: tournament.id},
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

<TournamentForm
  submitLabel="更新"
  initialValues={tournament}
  onSubmit={handleUpdate}
/>

{#if updated}
  <p>更新しました</p>
{/if}

<h2>フォーム定義の取り込み</h2>
<SheetImportPanel tournamentId={tournament.id} tournamentType={currentType} />
