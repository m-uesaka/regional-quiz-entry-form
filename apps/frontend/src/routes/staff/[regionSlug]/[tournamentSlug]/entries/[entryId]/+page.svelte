<script lang="ts">
  import {
    BOOLEAN_CHECKBOX_LABELS,
    ENTRY_STATUS_LABELS,
    isBooleanCheckbox,
    labelPlainText,
    type FormFieldDef,
  } from '@regional-quiz/shared';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import {ENTRY_STATUS_CHIP_VARIANT} from '$lib/entry-status';
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

<PageContainer>
  <p class="text-sm">
    <Link
      href={`/staff/${params.regionSlug}/${params.tournamentSlug}/entries`}
      variant="secondary"
    >
      ← 一覧へ戻る
    </Link>
  </p>

  <PageHeader title="{data.entry.displayName} さんのエントリー詳細" />

  <Card>
    <dl class="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
      <dt class="font-medium text-muted-foreground sm:py-1.5">氏名</dt>
      <dd class="mb-3 break-words sm:mb-0 sm:py-1.5">{data.entry.name}</dd>

      <dt class="font-medium text-muted-foreground sm:py-1.5">ふりがな</dt>
      <dd class="mb-3 break-words sm:mb-0 sm:py-1.5">{data.entry.furigana}</dd>

      <dt class="font-medium text-muted-foreground sm:py-1.5">掲載名</dt>
      <dd class="mb-3 break-words sm:mb-0 sm:py-1.5">{data.entry.displayName}</dd>

      <dt class="font-medium text-muted-foreground sm:py-1.5">メールアドレス</dt>
      <dd class="mb-3 break-all sm:mb-0 sm:py-1.5">{data.entry.email}</dd>

      <dt class="font-medium text-muted-foreground sm:py-1.5">レギュレーション</dt>
      <!-- An entry may claim several conditions, so they are listed rather than
           rendered as one value. Keyed by the regulation id rather than by the
           label: nothing stops a tournament from having two regulations under
           the same label, and a duplicate key is a render-time error. -->
      <dd class="mb-3 sm:mb-0 sm:py-1.5">
        <ul class="entry-regulations list-inside list-disc">
          {#each data.entry.regulationLabels as label, i (data.entry.regulationIds[i])}
            <li>{label}</li>
          {/each}
        </ul>
      </dd>

      <dt class="font-medium text-muted-foreground sm:py-1.5">ステータス</dt>
      <dd class="mb-3 sm:mb-0 sm:py-1.5">
        <Chip
          tone="soft"
          variant={ENTRY_STATUS_CHIP_VARIANT[data.entry.status]}
        >
          {ENTRY_STATUS_LABELS[data.entry.status]}
          {#if data.entry.status === 'waitlisted'}
            ({data.entry.waitlistPosition}番目)
          {/if}
        </Chip>
      </dd>

      {#if data.entry.freeText}
        <dt class="font-medium text-muted-foreground sm:py-1.5">自由記述</dt>
        <dd class="mb-3 whitespace-pre-wrap break-words sm:mb-0 sm:py-1.5">{data.entry.freeText}</dd>
      {/if}

      {#each customFieldEntries as {fieldDef, value} (fieldDef.fieldKey)}
        <dt class="font-medium text-muted-foreground sm:py-1.5">{labelPlainText(fieldDef.label)}</dt>
        <dd class="mb-3 break-words sm:mb-0 sm:py-1.5">
          {formatFieldValue(fieldDef, value)}
        </dd>
      {/each}
    </dl>
  </Card>
</PageContainer>
