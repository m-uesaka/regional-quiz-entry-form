<script lang="ts">
  import {untrack} from 'svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Table from '$lib/components/ui/atoms/Table.svelte';
  import TableData from '$lib/components/ui/atoms/TableData.svelte';
  import TableHead from '$lib/components/ui/atoms/TableHead.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {formatJstDateTime} from '$lib/jst-datetime';
  import type {PageProps} from './$types';

  const {form}: PageProps = $props();

  // Seeded from the action result once, then owned by the field. See "Form
  // controls are bound, not rendered from an expression" in
  // `apps/frontend/README.md`.
  let spreadsheetId = $state(untrack(() => form?.spreadsheetId ?? ''));

  // A few dozen spreadsheets take several seconds to read, so the button
  // says it is working and can't be pressed twice in the meantime. A plain
  // form post replaces the page when the answer arrives, which resets it.
  let submitting = $state(false);

  const results = $derived(form?.results ?? null);
  const failedRows = $derived(
    results?.filter(result => result.outcome === 'failed') ?? [],
  );
  const registeredRows = $derived(
    results?.filter(result => result.outcome !== 'failed') ?? [],
  );
  const createdCount = $derived(
    registeredRows.filter(result => result.outcome === 'created').length,
  );
</script>

<PageContainer size="wide">
  <PageHeader title="大会を一括登録" />

  <Card>
    <div class="flex flex-col gap-2 text-sm">
      <p>
        大会一覧のスプレッドシートから、記載されているすべての大会を登録します。各行の入力シート(スプレッドシートID)から、フォームの追加項目とレギュレーションも読み込みます。
      </p>
      <ul class="list-disc pl-5 text-muted-foreground">
        <li>エントリー期間は、開始が登録した時点、締切が実施日の前日 23:59 になります。</li>
        <li>
          同じ地域・種別の大会が既にある場合は、エントリー期間・追加項目・レギュレーションを上書きします(大会名・定員はそのまま)。
        </li>
        <li>
          エラーが出た大会は登録されません。理由を確認し、大会の画面から個別に登録してください。
        </li>
        <li>
          大会一覧と各入力シートは「リンクを知っている全員が閲覧可」にしておく必要があります。
        </li>
      </ul>
    </div>

    {#if form?.error}
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{form.error}</p>
      </Message>
    {/if}

    <form
      method="POST"
      class="flex flex-col gap-4"
      onsubmit={() => {
        submitting = true;
      }}
    >
      <div class="flex flex-col gap-1.5">
        <Label for="spreadsheet-id">大会一覧のスプレッドシート(URL または ID)</Label>
        <Input
          id="spreadsheet-id"
          class="w-full"
          name="spreadsheetId"
          bind:value={spreadsheetId}
          required
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? '登録中…' : '一括登録する'}
        </Button>
      </div>
    </form>
  </Card>

  {#if results}
    <section class="flex flex-col gap-4">
      <h2 class="text-lg font-bold">結果</h2>

      <Message variant={failedRows.length === 0 ? 'success' : 'warning'}>
        <p role="status" class="text-sm text-foreground">
          {registeredRows.length}件を登録しました(新規 {createdCount}件・上書き
          {registeredRows.length - createdCount}件)。{failedRows.length > 0
            ? `${failedRows.length}件はエラーのため登録していません。`
            : ''}
        </p>
      </Message>

      {#if failedRows.length > 0}
        <h3 class="text-base font-bold">登録できなかった大会</h3>
        <div class="overflow-x-auto">
          <Table class="w-full">
            <thead>
              <tr class="border-b border-border">
                <TableHead size="small">行</TableHead>
                <TableHead size="small">地域</TableHead>
                <TableHead size="small">種別</TableHead>
                <TableHead size="small">理由</TableHead>
              </tr>
            </thead>
            <tbody>
              {#each failedRows as result (result.row)}
                <tr class="border-b border-border">
                  <TableData size="small">{result.row}</TableData>
                  <TableData size="small">{result.regionName}</TableData>
                  <TableData size="small">{result.typeLabel}</TableData>
                  <TableData size="small" class="text-destructive">
                    {result.error}
                  </TableData>
                </tr>
              {/each}
            </tbody>
          </Table>
        </div>
      {/if}

      {#if registeredRows.length > 0}
        <h3 class="text-base font-bold">登録した大会</h3>
        <div class="overflow-x-auto">
          <Table class="w-full">
            <thead>
              <tr class="border-b border-border">
                <TableHead size="small">行</TableHead>
                <TableHead size="small">地域</TableHead>
                <TableHead size="small">種別</TableHead>
                <TableHead size="small">結果</TableHead>
                <TableHead size="small">エントリー期間 (JST)</TableHead>
                <TableHead size="small"><span class="sr-only">操作</span></TableHead>
              </tr>
            </thead>
            <tbody>
              {#each registeredRows as result (result.row)}
                <tr class="border-b border-border">
                  <TableData size="small">{result.row}</TableData>
                  <TableData size="small">{result.regionName}</TableData>
                  <TableData size="small">{result.typeLabel}</TableData>
                  <TableData size="small">
                    {result.outcome === 'created' ? '新規登録' : '上書き'}
                  </TableData>
                  <TableData size="small">
                    {result.entryOpensAt
                      ? formatJstDateTime(result.entryOpensAt)
                      : ''}〜{result.entryClosesAt
                      ? formatJstDateTime(result.entryClosesAt)
                      : ''}
                  </TableData>
                  <TableData size="small">
                    <Link href="/admin/tournaments/{result.tournamentId}/edit">
                      編集<span class="sr-only"
                        >({result.regionName}{result.typeLabel})</span
                      >
                    </Link>
                  </TableData>
                </tr>
              {/each}
            </tbody>
          </Table>
        </div>
      {/if}
    </section>
  {/if}
</PageContainer>
