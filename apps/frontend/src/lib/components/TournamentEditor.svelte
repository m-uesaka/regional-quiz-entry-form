<script lang="ts">
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import SheetImportPanel from '$lib/components/SheetImportPanel.svelte';
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

{#if result?.saved}
  <p role="status">更新しました</p>
{/if}
{#if result?.error}
  <p role="alert">{result.error}</p>
{/if}

<TournamentForm {regions} {values} submitLabel="更新" action="?/update" />

<h2>フォーム定義の取り込み</h2>
<!-- The panel's preview is YAML with the tournament's type baked in as its
     `tournamentSlug`, so a saved type change invalidates it: the panel would
     go on offering a preview whose upload the API now rejects as a slug
     mismatch, under a label already showing the new type. Keying on the type
     `load` last read drops that preview along with the id it was fetched
     for. -->
{#key tournament.type}
  <SheetImportPanel tournamentId={tournament.id} tournamentType={tournament.type} />
{/key}
