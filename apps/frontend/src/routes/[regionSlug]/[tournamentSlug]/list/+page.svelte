<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import type {PageProps} from './$types';
  let {data}: PageProps = $props();
</script>

<PageContainer>
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
  {/if}
</PageContainer>
