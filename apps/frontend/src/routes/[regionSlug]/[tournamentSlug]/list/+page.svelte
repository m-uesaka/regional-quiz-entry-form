<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import type {PageProps} from './$types';
  let {data}: PageProps = $props();
</script>

<PageContainer>
  <PageHeader title="エントリーリスト" />
  {#if data.entries.length > 0}
    <Card class="py-3">
      <ul class="divide-y divide-border">
        {#each data.entries as entry, i (i)}
          <li class="flex flex-wrap items-center gap-x-2 py-3 text-sm">
            {entry.displayName}
            {#if entry.status === 'waitlisted'}
              <span class="text-muted-foreground"
                >(キャンセル待ち {entry.waitlistPosition})</span
              >
            {/if}
          </li>
        {/each}
      </ul>
    </Card>
  {:else}
    <Card>
      <p class="text-sm text-muted-foreground">まだエントリーはありません。</p>
    </Card>
  {/if}
</PageContainer>
