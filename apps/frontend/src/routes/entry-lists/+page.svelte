<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();
</script>

<!-- Every tournament is listed, including those whose entries haven't
     opened: their list page is public too, and staff may already have
     entered someone on it. -->
<PageContainer>
  <PageHeader
    title="エントリーリスト一覧"
    description="各大会のエントリーリストへのリンクです。"
  />

  {#if data.regions.length === 0}
    <Card>
      <p class="text-sm text-muted-foreground">
        現在公開されている大会はありません。
      </p>
    </Card>
  {:else}
    {#each data.regions as region (region.regionSlug)}
      <Card class="gap-3">
        <h2 class="text-base font-bold">{region.regionName}</h2>
        <ul class="flex flex-col gap-2">
          {#each region.tournaments as tournament (tournament.entryListPath)}
            <li>
              <Link
                href={tournament.entryListPath}
                aria-label="{tournament.name}({tournament.typeLabel})のエントリーリスト"
              >
                {tournament.name}({tournament.typeLabel})
              </Link>
            </li>
          {/each}
        </ul>
      </Card>
    {/each}
  {/if}
</PageContainer>
