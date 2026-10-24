<script lang="ts">
  import {TOURNAMENT_TYPE_LABELS} from '@regional-quiz/shared';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {formatJstDateTime} from '$lib/jst-datetime';
  import type {PageProps} from './$types';

  const {data}: PageProps = $props();
</script>

<PageContainer size="wide">
  <PageHeader title="大会" />

  {#if data.deleted}
    <Message variant="success">
      <p role="status" class="text-sm text-foreground">大会を削除しました</p>
    </Message>
  {/if}

  <p class="text-sm">
    <Link href="/admin/tournaments/new">大会を作成</Link>
  </p>

  {#if data.tournaments.length > 0}
    <div class="overflow-x-auto">
      <Table class="w-full">
        <thead>
          <tr class="border-b border-border">
            <TableHead size="small">地域</TableHead>
            <TableHead size="small">種別</TableHead>
            <TableHead size="small">大会名</TableHead>
            <TableHead size="small">エントリー期間 (JST)</TableHead>
            <TableHead size="small"><span class="sr-only">操作</span></TableHead>
          </tr>
        </thead>
        <tbody>
          {#each data.tournaments as tournament (tournament.id)}
            <tr class="border-b border-border">
              <TableData size="small">{tournament.regionName}</TableData>
              <TableData size="small">
                {TOURNAMENT_TYPE_LABELS[tournament.type]}
              </TableData>
              <TableData size="small">{tournament.name}</TableData>
              <TableData size="small">
                {formatJstDateTime(tournament.entryOpensAt)}〜{formatJstDateTime(
                  tournament.entryClosesAt,
                )}
              </TableData>
              <TableData size="small">
                <Link href="/admin/tournaments/{tournament.id}/edit">
                  編集<span class="sr-only">({tournament.name})</span>
                </Link>
              </TableData>
            </tr>
          {/each}
        </tbody>
      </Table>
    </div>
  {:else}
    <Card>
      <p class="text-sm text-muted-foreground">大会はまだありません。</p>
    </Card>
  {/if}
</PageContainer>
