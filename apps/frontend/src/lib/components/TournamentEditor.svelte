<script lang="ts">
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import SheetImportPanel from '$lib/components/SheetImportPanel.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {toTournamentFormValues} from '$lib/tournament-form';
  import type {Tournament, Region} from '@regional-quiz/shared';
  import type {TournamentFormValues} from '$lib/types/tournament-form';

  interface Props {
    tournament: Tournament;
    /** Passed straight through to the form's region select. */
    regions: Region[];
    /** What the page's `update` action last answered with, if anything. */
    result: {
      saved: boolean;
      error: string | null;
      values: TournamentFormValues | null;
    } | null;
  }

  const {tournament, regions, result}: Props = $props();

  // A refused save re-renders what was submitted; anything else shows the
  // stored tournament, which `load` re-reads after every successful save.
  const values = $derived(result?.values ?? toTournamentFormValues(tournament));
</script>

<Card>
  {#if result?.saved}
    <Message variant="success">
      <p role="status" class="text-sm text-foreground">更新しました</p>
    </Message>
  {/if}
  {#if result?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm text-foreground">{result.error}</p>
    </Message>
  {/if}

  <TournamentForm {regions} {values} submitLabel="更新" action="?/update" />
</Card>

<section class="flex flex-col gap-4">
  <h2 class="text-lg font-bold">フォーム定義の取り込み</h2>
  <!-- The panel's preview is YAML with the tournament's type baked in as its
       `tournamentSlug`, so a saved type change invalidates it: the panel would
       go on offering a preview whose upload the API now rejects as a slug
       mismatch, under a label already showing the new type. Keying on the type
       `load` last read drops that preview along with the id it was fetched
       for. -->
  {#key tournament.type}
    <SheetImportPanel tournamentId={tournament.id} tournamentType={tournament.type} />
  {/key}
</section>
