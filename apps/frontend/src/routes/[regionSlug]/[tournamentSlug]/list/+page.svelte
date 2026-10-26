<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import {formatJstDateTimeSeconds} from '$lib/jst-datetime';
  import {pageQuery} from '$lib/pagination';
  import type {PageProps} from './$types';
  let {data}: PageProps = $props();

  // The list has no filters, so a page's URL is its offset alone.
  const hrefFor = (offset: number) => pageQuery(new URLSearchParams(), offset);
</script>

<PageContainer>
  <PageHeader title="エントリーリスト" />
  <Card>
    <ul class="list-disc space-y-1 pl-5 text-sm">
      <li>
        エントリーした時間は，確認メールのリンクをクリックしてエントリーが確定した時間のことです．
      </li>
      <li>
        エントリーリストにお名前がない場合，エントリー確認メールが来ていないか今一度確認ください．エントリー確認メールからエントリーを確定させたにもかかわらずエントリーリストに反映されない場合は，各地域の主催者にお問い合わせください．
      </li>
    </ul>
  </Card>
  {#if data.entries.length > 0}
    <Card class="overflow-x-auto py-3">
      <Table class="w-full">
        <thead>
          <tr class="border-b border-border">
            <TableHead size="small">No.</TableHead>
            <TableHead size="small">掲載名</TableHead>
            <TableHead size="small">エントリーした時間</TableHead>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as entry, i (i)}
            <tr class="border-b border-border last:border-b-0">
              <!-- Numbered across pages: the list comes in confirmation
                   order, so a row's place in it is its number. -->
              <TableData size="small" class="tabular-nums">
                {data.offset + i + 1}
              </TableData>
              <!-- The row's header, so the name is what a screen reader
                   announces the row's other cells by. Styled as body text
                   through an inner span: the atom doesn't merge classes,
                   so a `class` override would race its own. -->
              <TableHead size="small" scope="row">
                <span class="font-normal text-foreground">
                  {entry.displayName}
                  {#if entry.status === 'waitlisted'}
                    <span class="text-muted-foreground"
                      >(キャンセル待ち {entry.waitlistPosition})</span
                    >
                  {/if}
                </span>
              </TableHead>
              <TableData size="small" class="whitespace-nowrap tabular-nums">
                <!-- A cancelled row's time is masked like its name. -->
                {entry.confirmedAt
                  ? formatJstDateTimeSeconds(entry.confirmedAt)
                  : '—'}
              </TableData>
            </tr>
          {/each}
        </tbody>
      </Table>
    </Card>
  {:else}
    <!-- With entries but none on this page, the URL is a stale or
         hand-edited one past the last page; the pager below leads back. -->
    <Card>
      <p class="text-sm text-muted-foreground">
        {data.total > 0
          ? 'このページにはエントリーがありません。'
          : 'まだエントリーはありません。'}
      </p>
    </Card>
  {/if}
  {#if data.total > 0}
    <Pager
      total={data.total}
      limit={data.limit}
      offset={data.offset}
      {hrefFor}
    />
  {/if}
</PageContainer>
