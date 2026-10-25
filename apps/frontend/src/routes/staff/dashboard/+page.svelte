<script lang="ts">
  import {
    TOURNAMENT_TYPE_LABELS,
    calculateFillRate,
  } from '@regional-quiz/shared';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import type {PageProps} from './$types';

  let {data}: PageProps = $props();

  const totals = $derived({
    confirmed: data.summaries.reduce((sum, s) => sum + s.confirmedCount, 0),
    waitlisted: data.summaries.reduce((sum, s) => sum + s.waitlistedCount, 0),
    pendingVerification: data.summaries.reduce(
      (sum, s) => sum + s.pendingVerificationCount,
      0,
    ),
  });

  /**
   * The fill rate as a percentage, or a dash for an uncapped tournament —
   * there is no capacity for it to be a share of.
   * @param confirmedCount The tournament's confirmed entry count.
   * @param capacity The tournament's capacity, or null when uncapped.
   */
  function fillRateLabel(
    confirmedCount: number,
    capacity: number | null,
  ): string {
    const rate = calculateFillRate(confirmedCount, capacity);
    return rate === null ? '—' : `${Math.round(rate * 100)}%`;
  }

  /**
   * The per-tournament staff screens (Task 6-2 / 6-3 / 6-4) are keyed by
   * region slug and tournament type, and their API is scoped by
   * `requireStaffForTournament()`, which general staff pass for any region
   * — so this link is how those screens are reached across regions.
   * @param regionSlug The tournament's region slug.
   * @param tournamentType The tournament's type, used as the URL slug.
   */
  function entriesHref(regionSlug: string, tournamentType: string): string {
    return `/staff/${regionSlug}/${tournamentType}/entries`;
  }

  /**
   * The entry list participants see, so staff can check what is published
   * and copy the URL to share. It is a page outside the staff screens, so it
   * opens in a new tab and leaves the dashboard where it was.
   * @param regionSlug The tournament's region slug.
   * @param tournamentType The tournament's type, used as the URL slug.
   */
  function publicEntryListHref(
    regionSlug: string,
    tournamentType: string,
  ): string {
    return `/${regionSlug}/${tournamentType}/list`;
  }
</script>

<PageContainer size="wide">
  <PageHeader title="全地域エントリー状況" />

  <Card>
    <p class="text-sm">
      確定 {totals.confirmed} 件 / キャンセル待ち {totals.waitlisted} 件 / メール確認待ち
      {totals.pendingVerification} 件
    </p>
  </Card>

  {#if data.summaries.length === 0}
    <Card>
      <p class="text-sm text-muted-foreground">大会がまだ登録されていません。</p>
    </Card>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border shadow-xs">
      <Table class="w-full">
        <thead>
          <tr class="border-b border-border">
            <TableHead size="small">地域</TableHead>
            <TableHead size="small">大会</TableHead>
            <TableHead size="small">確定</TableHead>
            <TableHead size="small">定員</TableHead>
            <TableHead size="small">充足率</TableHead>
            <TableHead size="small">キャンセル待ち</TableHead>
            <TableHead size="small">メール確認待ち</TableHead>
            <TableHead size="small">操作</TableHead>
          </tr>
        </thead>
        <tbody>
          {#each data.summaries as summary (summary.tournamentId)}
            <tr class="border-b border-border last:border-b-0">
              <TableData size="small" class="whitespace-nowrap">
                {summary.regionName}
              </TableData>
              <TableData size="small">
                {summary.tournamentName}
                ({TOURNAMENT_TYPE_LABELS[summary.tournamentType]})
              </TableData>
              <TableData size="small" class="tabular-nums">
                {summary.confirmedCount}
              </TableData>
              <TableData size="small" class="tabular-nums">
                {summary.capacity ?? '制限なし'}
              </TableData>
              <TableData size="small" class="tabular-nums">
                {fillRateLabel(summary.confirmedCount, summary.capacity)}
              </TableData>
              <TableData size="small" class="tabular-nums">
                {summary.waitlistedCount}
              </TableData>
              <TableData size="small" class="tabular-nums">
                {summary.pendingVerificationCount}
              </TableData>
              <TableData size="small" class="whitespace-nowrap">
                <div class="flex flex-col gap-1">
                  <Link
                    href={entriesHref(
                      summary.regionSlug,
                      summary.tournamentType,
                    )}
                    aria-label="{summary.regionName} {summary.tournamentName}のエントリー一覧"
                  >
                    エントリー一覧
                  </Link>
                  <Link
                    href={publicEntryListHref(
                      summary.regionSlug,
                      summary.tournamentType,
                    )}
                    target="_blank"
                    aria-label="{summary.regionName} {summary.tournamentName}の公開エントリーリスト(新しいタブで開きます)"
                  >
                    公開エントリーリスト
                  </Link>
                </div>
              </TableData>
            </tr>
          {/each}
        </tbody>
      </Table>
    </div>
  {/if}
</PageContainer>
