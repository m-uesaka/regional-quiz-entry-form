<script lang="ts">
  import {ENTRY_STATUS_LABELS, EntryStatusSchema} from '@regional-quiz/shared';
  import Download from '@lucide/svelte/icons/download';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import NativeSelect from '$lib/components/form/NativeSelect.svelte';
  import Button, {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import {pageQuery} from '$lib/pagination';
  import {tournamentEntryFormPath} from '$lib/portal';
  import {ENTRY_STATUS_CHIP_VARIANT} from '$lib/entry-status';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import type {PageProps} from './$types';

  let {data, params, form}: PageProps = $props();

  const paused = $derived(data.tournament.entriesPaused);

  // A plain link rather than a `fetch`: the export is served from the same
  // origin as this page, so the browser sends the `staff_session` cookie
  // the endpoint authorizes against, and the response's
  // `Content-Disposition` triggers the download.
  const csvHref = $derived(
    `/api/staff/tournaments/${data.tournament.id}/entries.csv`,
  );

  // Paging keeps the status filter; changing the filter (the form below)
  // starts again from the first page, since it carries no offset.
  const hrefFor = (offset: number) =>
    pageQuery(
      new URLSearchParams(data.status ? {status: data.status} : {}),
      offset,
    );

  // `?/pause` alone would replace the page's query, so the list would come
  // back unfiltered on its first page after the action. The action is
  // added to the query the page is showing instead.
  const pauseAction = $derived.by(() => {
    const query = hrefFor(data.offset);
    return query === '?' ? '?/pause' : `${query}&/pause`;
  });
</script>

<PageContainer size="wide">
  <PageHeader title="{data.tournament.name} エントリー一覧">
    {#snippet actions()}
      <!-- The form participants fill in, for checking it before the entry
           period opens: outside the period it is shown only to the staff
           who cover the tournament (`middleware/entry-period.ts`), and the
           portal links to it only while it is open, so this is the way
           regional staff reach it. It opens in a new tab, like the
           dashboard's link to the public list. -->
      <Link
        href={tournamentEntryFormPath(params.regionSlug, data.tournament.type)}
        target="_blank"
        aria-label="エントリーフォームを確認(新しいタブで開きます)"
      >
        エントリーフォームを確認
      </Link>
      <a
        href={csvHref}
        download
        class={buttonVariants({variant: 'primary', tone: 'solid', size: 'small'})}
      >
        <Download class="size-4" aria-hidden="true" />CSV をダウンロード
      </a>
    {/snippet}
  </PageHeader>

  <!-- Pausing stops new entries (within the period or not) until it is
       resumed; entries already made can still be edited, cancelled and
       confirmed (0039). A form action, so it works without JavaScript. -->
  <Card class="gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-lg font-bold">エントリー受付</h2>
      <Chip variant={paused ? 'warning' : 'success'} tone="soft">
        {paused ? '一時中断中' : '通常'}
      </Chip>
    </div>
    <p class="text-sm">
      {#if paused}
        新しいエントリーの受付を一時中断しています。エントリーフォームは参加者に表示されず、ポータルには「一時中断中」と表示されます。
      {:else}
        一時中断すると、再開するまで新しいエントリーを受け付けません。すでにあるエントリーの編集・キャンセル・確認メールでの確定はそのまま行えます。
      {/if}
    </p>
    {#if form?.pauseError}
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{form.pauseError}</p>
      </Message>
    {:else if form?.paused !== undefined && form.paused !== null}
      <Message variant="success">
        <p role="status" class="text-sm text-foreground">
          {form.paused
            ? 'エントリー受付を一時中断しました'
            : 'エントリー受付を再開しました'}
        </p>
      </Message>
    {/if}
    <form method="POST" action={pauseAction}>
      <input type="hidden" name="tournamentId" value={data.tournament.id} />
      <input type="hidden" name="paused" value={paused ? 'false' : 'true'} />
      <Button type="submit" variant={paused ? 'primary' : 'danger'}>
        {paused ? 'エントリー受付を再開する' : 'エントリー受付を一時中断する'}
      </Button>
    </form>
  </Card>

  <p class="text-sm text-muted-foreground">
    この CSV は Excel / Google スプレッドシートで開く前提の出力です。数式として実行され
    るのを防ぐため、<code>=</code> <code>+</code> <code>-</code> <code>@</code>
    タブ・CR のいずれかで始まる値には先頭にアポストロフィが付きます。Excel / Google スプ
    レッドシートでは表示されませんが、Numbers やプログラムで読み込むと文字列として残るた
    め、他システムへの取り込みには使えません。
  </p>

  <!-- A plain GET form, so the filter lands in the URL like the pager's
    offset does and works without JavaScript. -->
  <form method="GET" class="flex flex-wrap items-end gap-2">
    <div class="flex flex-col gap-1">
      <Label for="status-filter">ステータス</Label>
      <NativeSelect id="status-filter" name="status" value={data.status ?? ''}>
        <option value="">すべて</option>
        {#each EntryStatusSchema.options as status (status)}
          <option value={status}>{ENTRY_STATUS_LABELS[status]}</option>
        {/each}
      </NativeSelect>
    </div>
    <Button type="submit" variant="secondary" tone="solid" size="medium">
      絞り込む
    </Button>
  </form>

  <div class="overflow-x-auto rounded-lg border border-border shadow-xs">
    <Table class="w-full">
      <thead>
        <tr class="border-b border-border">
          <TableHead size="small">氏名</TableHead>
          <TableHead size="small">ふりがな</TableHead>
          <TableHead size="small">エントリーリスト掲載名</TableHead>
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
                variant={ENTRY_STATUS_CHIP_VARIANT[entry.status]}
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
  {#if data.entries.length === 0}
    <p class="text-sm text-muted-foreground">該当するエントリーはありません。</p>
  {/if}

  <Pager
    total={data.total}
    limit={data.limit}
    offset={data.offset}
    {hrefFor}
  />
</PageContainer>
