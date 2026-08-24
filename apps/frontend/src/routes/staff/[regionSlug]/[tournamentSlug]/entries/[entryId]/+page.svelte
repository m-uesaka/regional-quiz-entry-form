<script lang="ts">
  import type {EntryStatus, FormFieldDef} from '@regional-quiz/shared';
  import type {PageProps} from './$types';

  let {data, params}: PageProps = $props();

  const STATUS_LABELS: Record<EntryStatus, string> = {
    pending_verification: 'メール確認待ち',
    confirmed: '確定',
    waitlisted: 'キャンセル待ち',
    cancelled: 'キャンセル',
  };

  // Renders each raw `customFieldValues` entry under its human-readable
  // label (via `formFieldDefs`) rather than its storage key (e.g.
  // `t_shirt_size`), in the tournament's configured display order. A field
  // with no matching definition (e.g. one removed from the form after this
  // entry was submitted) falls back to its raw key so the answer is still
  // shown.
  const customFieldEntries = $derived(
    data.entry.formFieldDefs.map(fieldDef => ({
      fieldDef,
      value: data.entry.customFieldValues[fieldDef.fieldKey],
    })),
  );

  const BOOLEAN_LABELS = {yes: 'はい', no: 'いいえ'};

  /**
   * A plain boolean checkbox (`type: 'checkbox'` with no `options`) stores
   * "checked" as an array containing the field's own key and "unchecked" as
   * an empty array (see `DynamicFormField.svelte`), which isn't meaningful
   * to a reader as-is — render it as a yes/no label instead.
   */
  function isBooleanCheckbox(fieldDef: FormFieldDef): boolean {
    return (
      fieldDef.fieldType === 'checkbox' &&
      (!fieldDef.options || fieldDef.options.length === 0)
    );
  }

  function formatFieldValue(
    fieldDef: FormFieldDef,
    value: string | string[] | undefined,
  ): string {
    if (isBooleanCheckbox(fieldDef)) {
      const checked = Array.isArray(value) && value.includes(fieldDef.fieldKey);
      return checked ? BOOLEAN_LABELS.yes : BOOLEAN_LABELS.no;
    }
    return Array.isArray(value) ? value.join('、') : String(value ?? '');
  }
</script>

<a href={`/staff/${params.regionSlug}/${params.tournamentSlug}/entries`}>
  ← 一覧へ戻る
</a>

<h1>{data.entry.displayName} さんのエントリー詳細</h1>

<dl>
  <dt>氏名</dt>
  <dd>{data.entry.name}</dd>

  <dt>ふりがな</dt>
  <dd>{data.entry.furigana}</dd>

  <dt>掲載名</dt>
  <dd>{data.entry.displayName}</dd>

  <dt>メールアドレス</dt>
  <dd>{data.entry.email}</dd>

  <dt>レギュレーション</dt>
  <dd>{data.entry.regulationLabel}</dd>

  <dt>ステータス</dt>
  <dd>
    {STATUS_LABELS[data.entry.status]}
    {#if data.entry.status === 'waitlisted'}
      ({data.entry.waitlistPosition}番目)
    {/if}
  </dd>

  {#if data.entry.freeText}
    <dt>自由記述</dt>
    <dd>{data.entry.freeText}</dd>
  {/if}

  {#each customFieldEntries as {fieldDef, value} (fieldDef.fieldKey)}
    <dt>{fieldDef.label}</dt>
    <dd>{formatFieldValue(fieldDef, value)}</dd>
  {/each}
</dl>
