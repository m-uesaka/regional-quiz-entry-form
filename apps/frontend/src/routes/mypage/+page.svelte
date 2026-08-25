<script lang="ts">
  import {isEntryEditable} from '@regional-quiz/shared';
  import type {PageProps} from './$types';
  let {data}: PageProps = $props();
</script>

<h1>マイページ</h1>
{#each data.entries as entry (entry.id)}
  <section>
    <h2>
      {entry.tournament.name}({entry.tournament.type === 'saikyoi'
        ? '最強位'
        : '新人王'})
    </h2>
    <p>ステータス: {entry.status}</p>
    <!-- The edit API refuses cancelled entries and closed entry periods, so
         the link is only offered where it would actually work. -->
    {#if isEntryEditable(entry)}
      <a href={`/mypage/entries/${entry.id}/edit`}>編集する</a>
    {:else}
      <p>編集期間は終了しました</p>
    {/if}
  </section>
{/each}
