<script lang="ts">
  import {ENTRY_STATUS_LABELS} from '@regional-quiz/shared';
  import Download from '@lucide/svelte/icons/download';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import type {PageProps} from './$types';

  let {data, params}: PageProps = $props();

  // A plain link rather than a `fetch`: the export is served from the same
  // origin as this page, so the browser sends the `staff_session` cookie
  // the endpoint authorizes against, and the response's
  // `Content-Disposition` triggers the download.
  const csvHref = $derived(
    `/api/staff/tournaments/${data.tournament.id}/entries.csv`,
  );
</script>

<PageContainer size="wide">
  <PageHeader title="{data.tournament.name} エントリー一覧">
    {#snippet actions()}
      <a
        href={csvHref}
        download
        class={buttonVariants({variant: 'primary', tone: 'solid', size: 'small'})}
      >
        <Download class="size-4" aria-hidden="true" />CSV をダウンロード
      </a>
    {/snippet}
  </PageHeader>

  <p class="text-sm text-muted-foreground">
    この CSV は Excel / Google スプレッドシートで開く前提の出力です。数式として実行され
    るのを防ぐため、<code>=</code> <code>+</code> <code>-</code> <code>@</code>
    タブ・CR のいずれかで始まる値には先頭にアポストロフィが付きます。Excel / Google スプ
    レッドシートでは表示されませんが、Numbers やプログラムで読み込むと文字列として残るた
    め、他システムへの取り込みには使えません。
  </p>

  <div class="overflow-x-auto rounded-lg border border-border shadow-xs">
    <Table class="w-full">
      <thead>
        <tr class="border-b border-border">
          <TableHead size="small">氏名</TableHead>
          <TableHead size="small">ふりがな</TableHead>
          <TableHead size="small">掲載名</TableHead>
          <TableHead size="small">メールアドレス</TableHead>
          <TableHead size="small">ステータス</TableHead>
          <TableHead size="small">操作</TableHead>
        </tr>
      </thead>
      <tbody>
        {#each data.entries as entry (entry.id)}
          <tr class="border-b border-border last:border-b-0">
            <TableData size="small" class="whitespace-nowrap">
              {entry.name}
            </TableData>
            <TableData size="small" class="whitespace-nowrap">
              {entry.furigana}
            </TableData>
            <TableData size="small" class="whitespace-nowrap">
              {entry.displayName}
            </TableData>
            <TableData size="small" class="break-all">{entry.email}</TableData>
            <TableData size="small">
              <Chip
                tone="soft"
                variant={entry.status === 'confirmed'
                  ? 'success'
                  : entry.status === 'waitlisted'
                    ? 'warning'
                    : entry.status === 'cancelled'
                      ? 'secondary'
                      : 'primary'}
                class="whitespace-nowrap"
              >
                {ENTRY_STATUS_LABELS[entry.status]}
                {#if entry.status === 'waitlisted'}({entry.waitlistPosition}番目){/if}
              </Chip>
            </TableData>
            <TableData size="small" class="whitespace-nowrap">
              <Link
                href={`/staff/${params.regionSlug}/${params.tournamentSlug}/entries/${entry.id}`}
              >
                詳細
              </Link>
            </TableData>
          </tr>
        {/each}
      </tbody>
    </Table>
  </div>
</PageContainer>
