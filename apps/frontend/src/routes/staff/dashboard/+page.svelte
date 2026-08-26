<script lang="ts">
  import {
    TOURNAMENT_TYPE_LABELS,
    calculateFillRate,
  } from '@regional-quiz/shared';
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
</script>

<h1>全地域エントリー状況</h1>

<p>
  確定 {totals.confirmed} 件 / キャンセル待ち {totals.waitlisted} 件 / メール確認待ち
  {totals.pendingVerification} 件
</p>

{#if data.summaries.length === 0}
  <p>大会がまだ登録されていません。</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>地域</th>
        <th>大会</th>
        <th>確定</th>
        <th>定員</th>
        <th>充足率</th>
        <th>キャンセル待ち</th>
        <th>メール確認待ち</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      {#each data.summaries as summary (summary.tournamentId)}
        <tr>
          <td>{summary.regionName}</td>
          <td>
            {summary.tournamentName}
            ({TOURNAMENT_TYPE_LABELS[summary.tournamentType]})
          </td>
          <td>{summary.confirmedCount}</td>
          <td>{summary.capacity ?? '制限なし'}</td>
          <td>{fillRateLabel(summary.confirmedCount, summary.capacity)}</td>
          <td>{summary.waitlistedCount}</td>
          <td>{summary.pendingVerificationCount}</td>
          <td>
            <a
              href={entriesHref(summary.regionSlug, summary.tournamentType)}
              aria-label="{summary.regionName} {summary.tournamentName}のエントリー一覧"
            >
              エントリー一覧
            </a>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
