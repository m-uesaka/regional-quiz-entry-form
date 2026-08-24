<script lang="ts">
  import {goto} from '$app/navigation';
  import {createApiClient} from '$lib/api';
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import type {TournamentFormValues} from '$lib/types/tournament-form';

  const api = createApiClient();

  async function handleCreate(
    values: TournamentFormValues,
  ): Promise<string | null> {
    const res = await api.api.tournaments.$post({json: values});
    const body = await res.json();
    if ('id' in body) {
      // Navigate away instead of leaving the create form mounted and
      // re-enabled: resubmitting it would insert another tournament, and
      // reusing this page for the sheet-import panel would retarget it at
      // the new tournament while any in-progress preview stayed mounted.
      await goto(`/admin/tournaments/${body.id}/edit`);
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
