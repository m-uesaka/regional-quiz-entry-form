<script lang="ts">
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
    <a href={`/mypage/${entry.tournamentId}/edit`}>編集する</a>
  </section>
{/each}
