<script lang="ts">
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import FormDefinitionEditor from '$lib/components/FormDefinitionEditor.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {toTournamentFormValues} from '$lib/tournament-form';
  import type {Tournament, Region} from '@regional-quiz/shared';
  import type {TournamentFormValues} from '$lib/types/tournament-form';

  interface Props {
    tournament: Tournament;
    /** The 大会名 as staff typed it, or null when it was left blank. */
    customName: string | null;
    /** The tournament's stored form definition, written out as YAML. */
    formDefinitionYaml: string;
    /** Passed straight through to the form's region select. */
    regions: Region[];
    /** What the page's `update` action last answered with, if anything. */
    result: {
      saved: boolean;
      error: string | null;
      values: TournamentFormValues | null;
    } | null;
  }

  const {tournament, customName, formDefinitionYaml, regions, result}: Props =
    $props();

  // A refused save re-renders what was submitted; anything else shows the
  // stored tournament, which `load` re-reads after every successful save.
  const values = $derived(
    result?.values ?? toTournamentFormValues(tournament, customName),
  );
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

<!-- The YAML carries the tournament's type as its `tournamentSlug`, so a
     saved type change invalidates the draft: the editor would go on offering
     text whose upload the API now rejects as a slug mismatch, under a label
     already showing the new type. Keying on the type `load` last read starts
     the editor over from the stored definition, rewritten for the new type. -->
{#key tournament.type}
  <FormDefinitionEditor
    tournamentId={tournament.id}
    tournamentType={tournament.type}
    initialYaml={formDefinitionYaml}
  />
{/key}
