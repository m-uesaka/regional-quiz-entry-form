<script lang="ts">
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
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<PageContainer size="wide">
  <PageHeader title="大会の表示順" />

  <div class="flex flex-col gap-1 text-sm text-muted-foreground">
    <p>
      エントリーポータル・エントリーリスト一覧・全地域ダッシュボード・大会一覧は、この順に表示されます。並べ替えるには「表示順」の番号を書き換えて保存してください(先頭に移すには
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
              <TableHead size="small">表示順</TableHead>
              <TableHead size="small">地域</TableHead>
              <TableHead size="small">種別</TableHead>
              <TableHead size="small">大会名</TableHead>
            </tr>
          </thead>
          <tbody>
            {#each data.tournaments as tournament, index (tournament.id)}
              <tr class="border-b border-border">
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
                    class="w-20"
                    name="tournaments[{index}].order"
                    type="number"
                    min="1"
                    value={String(index + 1)}
                    aria-label="{tournament.name}の表示順"
                  />
                </TableData>
                <TableData size="small">{tournament.regionName}</TableData>
                <TableData size="small">{tournament.typeLabel}</TableData>
                <TableData size="small">{tournament.name}</TableData>
              </tr>
            {/each}
          </tbody>
        </Table>
      </div>

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
