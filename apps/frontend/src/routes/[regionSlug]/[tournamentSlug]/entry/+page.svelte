<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import TournamentEntryForm from '$lib/components/TournamentEntryForm.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<PageContainer>
  <PageHeader title={`${data.tournament.name} へのエントリー`} />

  {#if form?.submitted}
    <Message variant="success">
      <p role="status" class="text-sm">
        エントリーを受け付けました。{form.email} 宛に確認メールを送信したので、
        メール内のリンクを開いてエントリーを確定してください。
      </p>
    </Message>
  {:else}
    {#if form?.error}
      <Message variant="danger">
        <p role="alert" class="text-sm">{form.error}</p>
      </Message>
    {/if}

    <Card>
      <!-- The form's controls own their values from their first render on, so
           they don't follow a later `data` change. SvelteKit keeps this page
           component across a navigation that changes only the route parameters,
           which would otherwise leave one tournament's answers standing in
           another tournament's form; keying on the tournament builds the form
           afresh instead. See #94. -->
      {#key data.tournament.id}
        <TournamentEntryForm
          formFieldDefs={data.formFieldDefs}
          regulations={data.regulations}
          values={form?.values}
          fieldErrors={form?.fieldErrors}
        />
      {/key}
    </Card>
  {/if}
</PageContainer>
