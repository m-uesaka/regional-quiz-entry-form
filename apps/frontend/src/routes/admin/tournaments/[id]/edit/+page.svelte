<script lang="ts">
  import TournamentEditor from '$lib/components/TournamentEditor.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<PageContainer>
  <PageHeader title="大会を編集" />

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

  <Card class="gap-3">
    <h2 class="text-lg font-bold">レギュレーション</h2>

    <p class="text-sm">
      <Link href="/admin/tournaments/{data.tournament.id}/regulations">
        レギュレーションを管理
      </Link>
    </p>
  </Card>
</PageContainer>
