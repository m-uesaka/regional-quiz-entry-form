<script lang="ts">
  import EntryEditForm from '$lib/components/EntryEditForm.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<PageContainer>
  <!-- An entry may claim several conditions, so they are listed rather than
       rendered as one value. -->
  <PageHeader
    title={`${data.entry.tournament.name} のエントリー内容を編集`}
    description={`レギュレーション: ${data.entry.regulationLabels.join('、')}`}
  />

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  <Card>
    <!-- The form's controls own their values from their first render on, so they
         don't follow a later `data` change. SvelteKit keeps this page component
         across a navigation that changes only the route parameters, which would
         otherwise leave one entry's answers standing in another entry's form —
         and saving would write them to that other entry; keying on the entry
         builds the form afresh instead. See #94. -->
    {#key data.entry.id}
      <EntryEditForm
        entry={data.entry}
        values={form?.values}
        fieldErrors={form?.fieldErrors}
      />
    {/key}
  </Card>

  <div class="text-sm">
    <Link href="/mypage" variant="secondary">マイページへ戻る</Link>
  </div>
</PageContainer>
