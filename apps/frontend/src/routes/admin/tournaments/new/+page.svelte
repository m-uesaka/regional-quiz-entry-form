<script lang="ts">
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import {emptyTournamentFormValues} from '$lib/tournament-form';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  // A refused create re-renders what was submitted; a fresh visit starts
  // from an empty form.
  const values = $derived(form?.values ?? emptyTournamentFormValues());
</script>

<h1>大会を作成</h1>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

<TournamentForm regions={data.regions} {values} submitLabel="作成" />
