<script lang="ts">
  import {
    REGULATION_LABEL_MAX_LENGTH,
    REGULATION_SHEET_NAME,
  } from '@regional-quiz/shared';
  import ReorderControls from '$lib/components/ReorderControls.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Checkbox from '$lib/components/ui/atoms/Checkbox.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {dragReorder, moveItem} from '$lib/drag-reorder';
  import {datetimeLocalStep} from '$lib/jst-datetime';
  import {
    emptyRegulationRow,
    isUntouchedNewRegulationRow,
    toRegulationRow,
  } from '$lib/regulation-rows';
  import type {RegulationRowValues} from '$lib/types/regulation-form';
  import type {PageProps} from './$types';

  const {data, form, params}: PageProps = $props();

  /**
   * Keeps exactly one blank row at the bottom, which is how a regulation is
   * added without any client-side scripting.
   *
   * Every blank row is dropped first rather than only the trailing one being
   * checked: a rejected save echoes back what was submitted, and a "表示順"
   * typed into the blank row sorts it away from the end — so a form that only
   * appended when the *last* row was a saved one grew another junk row on
   * every retry.
   *
   * @param current The rows to display.
   */
  function withBlankRow(
    current: RegulationRowValues[],
  ): RegulationRowValues[] {
    return [
      ...current.filter(row => !isUntouchedNewRegulationRow(row)),
      emptyRegulationRow(),
    ];
  }

  // A refused save re-renders what was submitted and an import shows what
  // the spreadsheet holds; anything else shows the stored regulations, which
  // `load` re-reads after every successful save.
  //
  // Each row is keyed by where it started, so moving it moves its controls
  // -- and whatever was typed into them -- with it. Saving submits the page
  // as a plain form, so the next load starts over from the server's rows.
  let rows = $derived(
    withBlankRow(form?.rows ?? data.regulations.map(toRegulationRow)).map(
      (row, key) => ({key, row}),
    ),
  );
  // Set once a row has been moved here. From then on every "表示順" shows
  // its row's position on screen, rather than the number a refused save
  // echoed back, which no longer matches where its row is.
  let moved = $state(false);
  // What a screen reader hears after a row is moved.
  let announcement = $state('');
  // The handles and buttons need scripting, so they only appear once it
  // runs; without it the "表示順" numbers still reorder the rows.
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });

  /**
   * What a row is called where it is announced or labelled.
   * @param row The row.
   * @param index Its position on screen.
   */
  function rowName(row: RegulationRowValues, index: number): string {
    return row.label.trim() || `${index + 1} 番目のレギュレーション`;
  }

  /**
   * Moves a row to another position.
   * @param from Its current index.
   * @param to The index it moves to.
   */
  function move(from: number, to: number) {
    const name = rowName(rows[from].row, from);
    rows = moveItem(rows, from, to);
    moved = true;
    announcement = `${name}を${to + 1}番目に移動しました`;
  }
</script>

<PageContainer>
  <PageHeader title="レギュレーションの管理" />

  <p class="text-sm text-muted-foreground">
    エントリーフォームには「表示順」の小さい順に表示されます。並び替えるには、つまみをドラッグするか矢印のボタンで動かすか、番号を書き換えてから保存してください。
  </p>

  {#if form?.saved}
    <Message variant="success">
      <p role="status" class="text-sm text-foreground">
        レギュレーションを保存しました
      </p>
    </Message>
  {/if}
  {#if form?.imported}
    <Message variant="default">
      <p role="status" class="text-sm text-foreground">
        スプレッドシートの内容を読み込みました。まだ保存されていません。内容を確認して
        「保存」を押してください。スプレッドシートに無いレギュレーションには「削除する」
        が付いています。
      </p>
    </Message>
  {/if}
  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm text-foreground">{form.error}</p>
    </Message>
  {/if}

  <Card>
    <!-- A separate form from the rows below, so reading a sheet submits only the
         spreadsheet ID and never the rows on screen. It saves nothing: the
         action answers with rows for the form underneath, which is the preview. -->
    <form method="POST" action="?/import" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">スプレッドシートから読み込む</h2>
        <p class="text-sm text-muted-foreground">
          地域スタッフが記入したスプレッドシートの「{REGULATION_SHEET_NAME}」シートを
          読み込み、下のフォームに反映します。「保存」を押すまで保存されません。
        </p>
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="regulation-import-spreadsheet-id">スプレッドシートID</Label>
        <Input
          id="regulation-import-spreadsheet-id"
          class="w-full"
          name="spreadsheetId"
          type="text"
          value={form?.spreadsheetId ?? ''}
          required
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary">
          スプレッドシートから読み込む
        </Button>
      </div>
    </form>
  </Card>

  <form method="POST" action="?/save" class="flex flex-col gap-4">
    <div class="flex flex-col gap-4" {@attach dragReorder(move)}>
      {#each rows as {key, row}, index (key)}
        <fieldset
          data-drag-item
          class="grid min-w-0 gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs data-dragging:relative data-dragging:z-10 data-dragging:bg-accent data-dragging:shadow-md sm:grid-cols-2 sm:p-6"
        >
          <legend class="px-1 text-sm font-bold">{index + 1} 番目</legend>

          {#if hydrated}
            <div class="sm:col-span-2">
              <ReorderControls
                label={rowName(row, index)}
                {index}
                count={rows.length}
                onmove={to => move(index, to)}
              />
            </div>
          {/if}

          <input type="hidden" name="regulations[{index}].id" value={row.id} />

          <div class="flex flex-col gap-1.5">
            <Label for="regulation-{index}-order">表示順</Label>
            <!-- Pre-filled with the row's current position so the numbers read
                 as an absolute order the staff member can rewrite, rather than
                 as an offset they have to work out. -->
            <Input
              id="regulation-{index}-order"
              class="w-full sm:w-32"
              name="regulations[{index}].order"
              type="number"
              min="1"
              value={moved || row.order === '' ? String(index + 1) : row.order}
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="regulation-{index}-label">レギュレーション名</Label>
            <Input
              id="regulation-{index}-label"
              class="w-full"
              name="regulations[{index}].label"
              type="text"
              maxlength={REGULATION_LABEL_MAX_LENGTH}
              value={row.label}
            />
          </div>

          <!-- Both ends are set together or not at all; the schema refuses a
               half-filled window rather than guessing the missing end. The step
               only drops to a second for a stored instant that falls mid-minute,
               which the default minute step would refuse outright. -->
          <div class="flex flex-col gap-1.5">
            <Label for="regulation-{index}-priority-starts-at">
              優先期間の開始 (JST)
            </Label>
            <Input
              id="regulation-{index}-priority-starts-at"
              class="w-full"
              name="regulations[{index}].priorityStartsAt"
              type="datetime-local"
              step={datetimeLocalStep(row.priorityStartsAt)}
              value={row.priorityStartsAt}
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="regulation-{index}-priority-ends-at">
              優先期間の終了 (JST)
            </Label>
            <Input
              id="regulation-{index}-priority-ends-at"
              class="w-full"
              name="regulations[{index}].priorityEndsAt"
              type="datetime-local"
              step={datetimeLocalStep(row.priorityEndsAt)}
              value={row.priorityEndsAt}
            />
          </div>

          {#if row.id !== ''}
            <div class="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id="regulation-{index}-remove"
                name="regulations[{index}].remove"
                checked={row.remove}
              />
              <Label for="regulation-{index}-remove">
                削除する
              </Label>
            </div>
          {/if}
        </fieldset>
      {/each}
    </div>
    <p class="sr-only" aria-live="polite">{announcement}</p>

    <div class="flex flex-wrap gap-2">
      <Button type="submit">保存</Button>
    </div>
  </form>

  <p class="text-sm">
    <Link href="/admin/tournaments/{params.id}/edit" variant="secondary">
      大会の編集へ戻る
    </Link>
  </p>
</PageContainer>
