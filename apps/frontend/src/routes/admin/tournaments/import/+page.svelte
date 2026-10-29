<script lang="ts">
  import {untrack} from 'svelte';
  import type {
    TournamentImportPreviewRow,
    TournamentImportSelection,
  } from '@regional-quiz/shared';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Checkbox from '$lib/components/ui/atoms/Checkbox.svelte';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
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

  /**
   * What a row's checkbox posts: its names, and the action and fingerprint
   * the preview offered, which the API holds the registration to.
   */
  function selectionValue(row: TournamentImportPreviewRow): string {
    return JSON.stringify({
      regionName: row.regionName,
      typeLabel: row.typeLabel,
      action: row.action ?? 'create',
      fingerprint: row.fingerprint ?? '',
    } satisfies TournamentImportSelection);
  }

  function formatCapacity(capacity: number | null): string {
    return capacity === null ? '定員なし' : `${capacity}名`;
  }

  function formatInstant(iso: string | null): string {
    return iso === null ? '' : formatJstDateTime(iso);
  }

  const rows = $derived(form?.rows ?? null);
  const results = $derived(form?.results ?? null);
  const registrableRows = $derived(
    rows?.filter(row => row.action !== null) ?? [],
  );
  const invalidRows = $derived(rows?.filter(row => row.action === null) ?? []);

  // Seeded from the action result once, then owned by the controls. See
  // "Form controls are bound, not rendered from an expression" in
  // `apps/frontend/README.md`. New tournaments start chosen; overwriting
  // one already registered is left for staff to choose deliberately.
  let spreadsheetId = $state(untrack(() => form?.spreadsheetId ?? ''));
  let selected = $state<string[]>(
    untrack(() =>
      (form?.rows ?? [])
        .filter(row => row.action === 'create')
        .map(selectionValue),
    ),
  );

  // A few dozen spreadsheets take several seconds to read, so the buttons
  // say they are working and can't be pressed twice in the meantime. A
  // plain form post replaces the page when the answer arrives, which resets
  // them; `pageshow` resets them when the page comes back without being
  // replaced instead (Back pressed mid-request, restored from the bfcache).
  let previewing = $state(false);
  let executing = $state(false);

  const createdCount = $derived(
    results?.filter(result => result.outcome === 'created').length ?? 0,
  );
  const failedRows = $derived(
    results?.filter(result => result.outcome === 'failed') ?? [],
  );
  const registeredRows = $derived(
    results?.filter(result => result.outcome !== 'failed') ?? [],
  );
</script>

<svelte:window
  onpageshow={() => {
    previewing = false;
    executing = false;
  }}
/>

<PageContainer size="wide">
  <PageHeader title="大会を一括登録" />

  <Card>
    <div class="flex flex-col gap-2 text-sm">
      <p>
        大会一覧のスプレッドシートを読み込み、記載されている大会を確認してから登録します。各行の入力シート(スプレッドシートID)から、フォームの追加項目とレギュレーションも読み込みます。
      </p>
      <ul class="list-disc pl-5 text-muted-foreground">
        <li>
          定員・エントリー開始・エントリー終了は大会一覧の値を使います(定員が空欄の大会は定員なし)。
        </li>
        <li>
          読み込んだ時点では何も登録されません。大会ごとに、新規作成するか・既にある大会を上書きするかを選んで登録します。
        </li>
        <li>
          上書きすると、定員・エントリー期間・追加項目・レギュレーションがシートの内容に置き換わります(大会名はそのまま)。
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
      action="?/preview"
      class="flex flex-col gap-4"
      onsubmit={() => {
        previewing = true;
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
        <Button type="submit" disabled={previewing}>
          {previewing ? '読み込み中…' : '読み込む'}
        </Button>
      </div>
    </form>
  </Card>

  {#if rows}
    <section class="flex flex-col gap-4">
      <h2 class="text-lg font-bold">登録する大会を選ぶ</h2>

      <p class="text-sm">
        {rows.length}件を読み込みました(新規作成 {registrableRows.filter(
          row => row.action === 'create',
        ).length}件・上書き {registrableRows.filter(
          row => row.action === 'overwrite',
        ).length}件・登録できない大会 {invalidRows.length}件)。
      </p>

      {#if registrableRows.length > 0}
        <form
          method="POST"
          action="?/execute"
          class="flex flex-col gap-4"
          onsubmit={() => {
            executing = true;
          }}
        >
          <!-- The sheet that was read, not whatever the field above has been
               changed to since: the choices below are about this one. -->
          <input
            type="hidden"
            name="spreadsheetId"
            value={form?.spreadsheetId ?? ''}
          />

          <div class="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              tone="ghost"
              size="small"
              onclick={() => {
                selected = registrableRows.map(selectionValue);
              }}
            >
              すべて選択
            </Button>
            <Button
              type="button"
              variant="secondary"
              tone="ghost"
              size="small"
              onclick={() => {
                selected = registrableRows
                  .filter(row => row.action === 'create')
                  .map(selectionValue);
              }}
            >
              新規作成のみ選択
            </Button>
            <Button
              type="button"
              variant="secondary"
              tone="ghost"
              size="small"
              onclick={() => {
                selected = [];
              }}
            >
              選択を解除
            </Button>
          </div>

          <div class="overflow-x-auto">
            <Table class="w-full">
              <thead>
                <tr class="border-b border-border">
                  <TableHead size="small">登録</TableHead>
                  <TableHead size="small">行</TableHead>
                  <TableHead size="small">大会</TableHead>
                  <TableHead size="small">操作</TableHead>
                  <TableHead size="small">定員</TableHead>
                  <TableHead size="small">エントリー期間 (JST)</TableHead>
                  <TableHead size="small">追加項目</TableHead>
                  <TableHead size="small">レギュレーション</TableHead>
                </tr>
              </thead>
              <tbody>
                {#each registrableRows as row (row.row)}
                  {@const current = row.current}
                  <tr class="border-b border-border align-top">
                    <TableData size="small">
                      <Checkbox
                        name="selection"
                        value={selectionValue(row)}
                        bind:group={selected}
                        aria-label="{row.regionName}{row.typeLabel}を{row.action ===
                        'overwrite'
                          ? '上書き'
                          : '新規作成'}する"
                      />
                    </TableData>
                    <TableData size="small">{row.row}</TableData>
                    <TableData size="small">
                      {row.regionName}{row.typeLabel}
                      {#if current && current.name !== `${row.regionName}${row.typeLabel}`}
                        <div class="text-xs text-muted-foreground">
                          登録済みの大会名: {current.name}
                        </div>
                      {/if}
                    </TableData>
                    <TableData size="small">
                      {#if row.action === 'overwrite'}
                        <Chip variant="warning" tone="soft">上書き</Chip>
                      {:else}
                        <Chip variant="success" tone="soft">新規作成</Chip>
                      {/if}
                    </TableData>
                    <TableData size="small">
                      {formatCapacity(row.capacity)}
                      {#if current && current.capacity !== row.capacity}
                        <div class="text-xs text-muted-foreground">
                          現在: {formatCapacity(current.capacity)}
                        </div>
                      {/if}
                    </TableData>
                    <TableData size="small">
                      {formatInstant(row.entryOpensAt)}〜{formatInstant(
                        row.entryClosesAt,
                      )}
                      {#if current && (current.entryOpensAt !== row.entryOpensAt || current.entryClosesAt !== row.entryClosesAt)}
                        <div class="text-xs text-muted-foreground">
                          現在: {formatInstant(
                            current.entryOpensAt,
                          )}〜{formatInstant(current.entryClosesAt)}
                        </div>
                      {/if}
                    </TableData>
                    <TableData size="small">
                      {#if row.formFieldLabels.length === 0}
                        なし
                      {:else}
                        <details>
                          <summary class="cursor-pointer">
                            {row.formFieldLabels.length}件
                          </summary>
                          <ul class="list-disc pl-5 text-xs">
                            {#each row.formFieldLabels as label, index (index)}
                              <li>{label}</li>
                            {/each}
                          </ul>
                        </details>
                      {/if}
                    </TableData>
                    <TableData size="small">
                      <ul class="list-disc pl-5 text-xs">
                        {#each row.regulationLabels as label, index (index)}
                          <li>{label}</li>
                        {/each}
                      </ul>
                    </TableData>
                  </tr>
                {/each}
              </tbody>
            </Table>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={executing || selected.length === 0}
            >
              {executing
                ? '登録中…'
                : `選択した${selected.length}件を登録する`}
            </Button>
          </div>
        </form>
      {/if}

      {#if invalidRows.length > 0}
        <h3 class="text-base font-bold">登録できない大会</h3>
        <p class="text-sm text-muted-foreground">
          理由を確認してシートを直し、もう一度読み込んでください。大会の画面から個別に登録することもできます。
        </p>
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
              {#each invalidRows as row (row.row)}
                <tr class="border-b border-border">
                  <TableData size="small">{row.row}</TableData>
                  <TableData size="small">{row.regionName}</TableData>
                  <TableData size="small">{row.typeLabel}</TableData>
                  <TableData size="small" class="text-destructive">
                    {row.error}
                  </TableData>
                </tr>
              {/each}
            </tbody>
          </Table>
        </div>
      {/if}
    </section>
  {/if}

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
              {#each failedRows as result, index (index)}
                <tr class="border-b border-border">
                  <TableData size="small">{result.row ?? '—'}</TableData>
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
                <TableHead size="small">定員</TableHead>
                <TableHead size="small">エントリー期間 (JST)</TableHead>
                <TableHead size="small"><span class="sr-only">操作</span></TableHead>
              </tr>
            </thead>
            <tbody>
              {#each registeredRows as result (result.tournamentId)}
                <tr class="border-b border-border">
                  <TableData size="small">{result.row}</TableData>
                  <TableData size="small">{result.regionName}</TableData>
                  <TableData size="small">{result.typeLabel}</TableData>
                  <TableData size="small">
                    {result.outcome === 'created' ? '新規登録' : '上書き'}
                  </TableData>
                  <TableData size="small">
                    {formatCapacity(result.capacity)}
                  </TableData>
                  <TableData size="small">
                    {formatInstant(result.entryOpensAt)}〜{formatInstant(
                      result.entryClosesAt,
                    )}
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
