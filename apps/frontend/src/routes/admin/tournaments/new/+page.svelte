<script lang="ts">
  import TournamentForm from '$lib/components/TournamentForm.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
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
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{form.error}</p>
      </Message>
    {/if}

    <TournamentForm regions={data.regions} {values} submitLabel="作成" />
  </Card>
</PageContainer>
