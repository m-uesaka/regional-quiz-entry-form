<script lang="ts">
  import TournamentEditor from '$lib/components/TournamentEditor.svelte';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();
</script>

<h1>大会を編集</h1>

<!-- The editor's form controls, its confirmed tournament type and the import
     panel's own draft are all seeded on the first render and stop following
     `data` after it. SvelteKit keeps this page component across a navigation
     that changes only the route parameters, which would otherwise leave one
     tournament's details standing in another tournament's form — and saving
     would write them to that other tournament, while the import panel would
     file the first tournament's sheet under the second one's id. Keying on
     the tournament builds all of it afresh instead. See #98. -->
{#key data.tournament.id}
  <TournamentEditor tournament={data.tournament} />
{/key}
