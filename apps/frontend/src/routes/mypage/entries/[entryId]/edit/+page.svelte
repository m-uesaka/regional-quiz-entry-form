<script lang="ts">
  import EntryEditForm from '$lib/components/EntryEditForm.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<h1>{data.entry.tournament.name} のエントリー内容を編集</h1>

<p>レギュレーション: {data.entry.regulationLabel}</p>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

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

<a href="/mypage">マイページへ戻る</a>
