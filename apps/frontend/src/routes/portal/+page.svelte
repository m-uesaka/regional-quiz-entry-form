<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PriorityEntryNotices from '$lib/components/PriorityEntryNotices.svelte';
  import {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
  import {PORTAL_STATUS_LABELS, type PortalStatus} from '$lib/portal';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();

  const STATUS_CHIP_VARIANT: Record<PortalStatus, 'success' | 'primary' | 'secondary'> = {
    open: 'success',
    upcoming: 'primary',
    closed: 'secondary',
  };
</script>

<PageContainer>
  <PageHeader
    title="エントリーポータル"
    description="地域クイズ最強位・新人王の各地域のエントリーフォームの一覧です。"
  />

  <Card class="gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-bold">マイページ</h2>
      <p class="text-sm text-muted-foreground">
        エントリー済みの方は、マイページでエントリー内容の確認・編集・キャンセルができます。
      </p>
    </div>
    <a
      href="/mypage"
      class={[
        buttonVariants({variant: 'secondary', tone: 'solid', size: 'medium'}),
        'shrink-0',
      ]}
    >
      マイページへ
    </a>
  </Card>

  <section class="flex flex-col gap-4" aria-labelledby="portal-forms-heading">
    <h2 id="portal-forms-heading" class="text-lg font-bold">エントリーフォーム</h2>

    {#if data.regions.length === 0}
      <Card>
        <p class="text-sm text-muted-foreground">
          現在公開されている大会はありません。
        </p>
      </Card>
    {:else}
      {#each data.regions as region (region.regionSlug)}
        <Card class="gap-4">
          <h3 class="text-base font-bold">{region.regionName}</h3>
          <ul class="flex flex-col divide-y divide-border">
            {#each region.tournaments as tournament (tournament.entryPath)}
              <li
                class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="flex flex-col gap-1.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{tournament.name}</span>
                    <Chip variant="secondary" tone="outlined">
                      {tournament.typeLabel}
                    </Chip>
                    <Chip variant={STATUS_CHIP_VARIANT[tournament.status]} tone="soft">
                      {PORTAL_STATUS_LABELS[tournament.status]}
                    </Chip>
                  </div>
                  <p class="text-sm text-muted-foreground">
                    受付期間: {tournament.entryPeriodLabel}
                  </p>
                  {#if tournament.capacityLabel}
                    <p class="text-sm text-muted-foreground">{tournament.capacityLabel}</p>
                  {/if}
                  <PriorityEntryNotices
                    notices={tournament.priorityNotices}
                    class="font-medium text-primary"
                  />
                </div>
                {#if tournament.status === 'open'}
                  <a
                    href={tournament.entryPath}
                    aria-label="{tournament.name}にエントリーする"
                    class={[
                      buttonVariants({variant: 'primary', tone: 'solid', size: 'medium'}),
                      'shrink-0',
                    ]}
                  >
                    エントリーする
                  </a>
                {/if}
              </li>
            {/each}
          </ul>
        </Card>
      {/each}
    {/if}
  </section>
</PageContainer>
