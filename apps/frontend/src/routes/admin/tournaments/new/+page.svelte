<script lang="ts">
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import FlashMessage from '$lib/components/ui/items/FlashMessage.svelte';
  import {emptyTournamentFormValues} from '$lib/tournament-form';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  // A refused create re-renders what was submitted; a fresh visit starts
  // from an empty form.
  const values = $derived(form?.values ?? emptyTournamentFormValues());
</script>

<PageContainer>
  <PageHeader title="大会を作成" />

  <Card>
    {#if form?.error}
      <FlashMessage kind="error">{form.error}</FlashMessage>
    {/if}

    <TournamentForm
      regions={data.regions}
      {values}
      questionSets={data.questionSets}
      submitLabel="作成"
    />
  </Card>
</PageContainer>
