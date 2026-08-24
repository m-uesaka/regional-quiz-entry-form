<script lang="ts">
  import type {EntryStatus} from '@regional-quiz/shared';
  import type {PageProps} from './$types';

  let {data, params}: PageProps = $props();

  const STATUS_LABELS: Record<EntryStatus, string> = {
    pending_verification: 'メール確認待ち',
    confirmed: '確定',
    waitlisted: 'キャンセル待ち',
    cancelled: 'キャンセル',
  };

  const customFieldEntries = $derived(
    Object.entries(data.entry.customFieldValues),
  );
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

  {#each customFieldEntries as [key, value] (key)}
    <dt>{key}</dt>
    <dd>{Array.isArray(value) ? value.join('、') : String(value)}</dd>
  {/each}
</dl>
