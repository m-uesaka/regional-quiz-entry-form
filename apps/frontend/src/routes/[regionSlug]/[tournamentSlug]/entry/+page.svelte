<script lang="ts">
  import TournamentEntryForm from '$lib/components/TournamentEntryForm.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<h1>{data.tournament.name} へのエントリー</h1>

{#if form?.submitted}
  <p role="status">
    エントリーを受け付けました。{form.email} 宛に確認メールを送信したので、
    メール内のリンクを開いてエントリーを確定してください。
  </p>
{:else}
  {#if form?.error}
    <p role="alert">{form.error}</p>
  {/if}

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
{/if}
