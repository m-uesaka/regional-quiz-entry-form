<script lang="ts">
  import TournamentEditor from '$lib/components/TournamentEditor.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<h1>大会を編集</h1>

<!-- The import panel's own draft is seeded on its first render and stops
     following `data` after it. SvelteKit keeps this page component across a
     navigation that changes only the route parameters, which would otherwise
     leave one tournament's sheet filed under the next one's id. Keying on
     the tournament builds it afresh instead. See #98. -->
{#key data.tournament.id}
  <TournamentEditor
    tournament={data.tournament}
    regions={data.regions}
    result={form}
  />
{/key}

<h2>レギュレーション</h2>

<p>
  <a href="/admin/tournaments/{data.tournament.id}/regulations">
    レギュレーションを管理
  </a>
</p>
