<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();

  // A tournament whose entries haven't opened has nobody on its list yet,
  // so it gets no link.
  const listedRegions = $derived(
    data.regions
      ?.map(region => ({
        ...region,
        tournaments: region.tournaments.filter(
          tournament => tournament.status !== 'upcoming',
        ),
      }))
      .filter(region => region.tournaments.length > 0) ?? null,
  );
</script>

<PageContainer>
  <PageHeader
    title="地域クイズ最強位・新人王 エントリー"
    description="エントリーは、エントリーポータルにある各地域のエントリーフォームから行ってください。"
  />

  <div class="grid gap-4 sm:grid-cols-2">
    <Card class="justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">参加者の方</h2>
        <p class="text-sm text-muted-foreground">
          エントリーはエントリーポータルから。エントリー内容の確認・編集・キャンセルはマイページから。
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <a
          href="/portal"
          class={buttonVariants({variant: 'primary', tone: 'solid', size: 'medium'})}
        >
          エントリーポータル
        </a>
        <a
          href="/mypage"
          class={buttonVariants({variant: 'secondary', tone: 'solid', size: 'medium'})}
        >
          マイページ
        </a>
      </div>
    </Card>

    <Card class="justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">スタッフの方</h2>
        <p class="text-sm text-muted-foreground">
          大会の設定やエントリーの管理はこちらから。
        </p>
      </div>
      <a
        href="/staff/login"
        class={buttonVariants({variant: 'secondary', tone: 'solid', size: 'medium'})}
      >
        スタッフログイン
      </a>
    </Card>
  </div>

  <section class="flex flex-col gap-4" aria-labelledby="entry-lists-heading">
    <div class="flex flex-col gap-1">
      <h2 id="entry-lists-heading" class="text-lg font-bold">エントリーリスト</h2>
      <p class="text-sm text-muted-foreground">
        各大会にエントリーした方の一覧です。
      </p>
    </div>

    <Card>
      {#if listedRegions === null}
        <p class="text-sm text-muted-foreground">
          大会一覧を読み込めませんでした。時間をおいて再度お試しください。
        </p>
      {:else if listedRegions.length === 0}
        <p class="text-sm text-muted-foreground">
          公開されているエントリーリストはまだありません。
        </p>
      {:else}
        <ul class="flex flex-col divide-y divide-border">
          {#each listedRegions as region (region.regionSlug)}
            <li
              class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
            >
              <h3 class="w-24 shrink-0 font-bold">{region.regionName}</h3>
              <ul class="flex flex-wrap gap-x-6 gap-y-1">
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
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  </section>
</PageContainer>
