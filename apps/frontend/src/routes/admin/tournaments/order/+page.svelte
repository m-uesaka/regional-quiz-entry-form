<script lang="ts">
  import ReorderControls from '$lib/components/ReorderControls.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {tick} from 'svelte';
  import {dragReorder, moveItem, renumberRows} from '$lib/drag-reorder';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  // Reordered on screen until saved. Saving submits the page as a plain form,
  // so the next load starts again from what the API has.
  let tournaments = $derived(data.tournaments);
  let list = $state<HTMLElement>();
  // What a screen reader hears after a row is moved.
  let announcement = $state('');
  // The handles and buttons need scripting, so they only appear once it
  // runs; without it the numbers below still reorder the tournaments.
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });

  /**
   * Moves a tournament to another position, then numbers every row by
   * where it now is -- a number typed in by hand included, so what is saved
   * is the order on screen.
   * @param from Its current index.
   * @param to The index it moves to.
   */
  async function move(from: number, to: number) {
    const name = tournaments[from].name;
    tournaments = moveItem(tournaments, from, to);
    announcement = `${name}を${to + 1}番目に移動しました`;
    await tick();
    if (list) renumberRows(list);
  }
</script>

<PageContainer size="wide">
  <PageHeader title="大会の表示順" />

  <div class="flex flex-col gap-1 text-sm text-muted-foreground">
    <p>
      エントリーポータル・エントリーリスト一覧・全地域ダッシュボード・大会一覧は、この順に表示されます。左端のつまみをドラッグするか、矢印のボタンで並べ替えてから保存してください。「表示順」の番号を書き換えても並べ替えられます(先頭に移すには
      1 を入力します)。
    </p>
    <p>
      エントリーポータルとエントリーリスト一覧では、大会は地域ごとにまとめて表示されます。地域の順は、その地域の大会のうち最も上にあるものの位置で決まります。
    </p>
  </div>

  {#if form?.saved}
    <Message variant="success">
      <p role="status" class="text-sm text-foreground">表示順を保存しました</p>
    </Message>
  {/if}
  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm text-foreground">{form.error}</p>
    </Message>
  {/if}

  {#if data.tournaments.length > 0}
    <form method="POST" class="flex flex-col gap-4">
      <div class="overflow-x-auto">
        <Table class="w-full">
          <thead>
            <tr class="border-b border-border">
              {#if hydrated}
                <TableHead size="small">
                  <span class="sr-only">並べ替え</span>
                </TableHead>
              {/if}
              <TableHead size="small">表示順</TableHead>
              <!-- On a phone the region and type go under the name instead,
                   so the name isn't pushed off the screen being dragged on. -->
              <TableHead size="small" class="hidden sm:table-cell">地域</TableHead>
              <TableHead size="small" class="hidden sm:table-cell">種別</TableHead>
              <TableHead size="small">大会名</TableHead>
            </tr>
          </thead>
          <tbody bind:this={list} {@attach dragReorder(move)}>
            {#each tournaments as tournament, index (tournament.id)}
              <tr
                data-drag-item
                class="border-b border-border bg-surface data-dragging:relative data-dragging:z-10 data-dragging:bg-accent data-dragging:shadow-md"
              >
                {#if hydrated}
                  <TableData size="small">
                    <ReorderControls
                      label={tournament.name}
                      {index}
                      count={tournaments.length}
                      onmove={to => move(index, to)}
                    />
                  </TableData>
                {/if}
                <TableData size="small">
                  <input
                    type="hidden"
                    name="tournaments[{index}].id"
                    value={tournament.id}
                  />
                  <!-- Pre-filled with the current position, so the numbers
                       read as an absolute order to rewrite rather than as
                       an offset to work out. -->
                  <Input
                    class="w-16 sm:w-20"
                    name="tournaments[{index}].order"
                    data-reorder-position
                    type="number"
                    min="1"
                    value={String(index + 1)}
                    aria-label="{tournament.name}の表示順"
                  />
                </TableData>
                <TableData size="small" class="hidden sm:table-cell">
                  {tournament.regionName}
                </TableData>
                <TableData size="small" class="hidden sm:table-cell">
                  {tournament.typeLabel}
                </TableData>
                <TableData size="small">
                  {tournament.name}
                  <span class="block text-xs text-muted-foreground sm:hidden">
                    {tournament.regionName}・{tournament.typeLabel}
                  </span>
                </TableData>
              </tr>
            {/each}
          </tbody>
        </Table>
      </div>
      <p class="sr-only" aria-live="polite">{announcement}</p>

      <div class="flex flex-wrap items-center gap-4">
        <Button type="submit">保存</Button>
        <Link href="/admin/tournaments">大会一覧へ戻る</Link>
      </div>
    </form>
  {:else}
    <Card>
      <p class="text-sm text-muted-foreground">大会はまだありません。</p>
    </Card>
  {/if}
</PageContainer>
