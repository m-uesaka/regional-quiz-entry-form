<script lang="ts">
  import {
    BOOLEAN_CHECKBOX_LABELS,
    ENTRY_STATUS_LABELS,
    isBooleanCheckbox,
    type FormFieldDef,
  } from '@regional-quiz/shared';
  import type {PageProps} from './$types';

  let {data, params}: PageProps = $props();

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

  // A plain boolean checkbox stores "checked" as an array containing the
  // field's own key and "unchecked" as an empty array (see
  // `DynamicFormField.svelte`), which isn't meaningful to a reader as-is —
  // render it as a yes/no label instead. The staff CSV export
  // (`lib/entries-csv.ts` in the backend) uses the same labels.
  function formatFieldValue(
    fieldDef: FormFieldDef,
    value: string | string[] | undefined,
  ): string {
    if (isBooleanCheckbox(fieldDef)) {
      const checked = Array.isArray(value) && value.includes(fieldDef.fieldKey);
      return checked
        ? BOOLEAN_CHECKBOX_LABELS.checked
        : BOOLEAN_CHECKBOX_LABELS.unchecked;
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
  <!-- An entry may claim several conditions, so they are listed rather than
       rendered as one value. -->
  <dd>
    <ul class="entry-regulations">
      {#each data.entry.regulationLabels as label (label)}
        <li>{label}</li>
      {/each}
    </ul>
  </dd>

  <dt>ステータス</dt>
  <dd>
    {ENTRY_STATUS_LABELS[data.entry.status]}
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
