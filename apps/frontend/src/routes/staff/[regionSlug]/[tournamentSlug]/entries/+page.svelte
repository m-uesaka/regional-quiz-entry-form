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
</script>

<h1>{data.tournament.name} エントリー一覧</h1>

<table>
  <thead>
    <tr>
      <th>氏名</th>
      <th>ふりがな</th>
      <th>掲載名</th>
      <th>メールアドレス</th>
      <th>ステータス</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#each data.entries as entry (entry.id)}
      <tr>
        <td>{entry.name}</td>
        <td>{entry.furigana}</td>
        <td>{entry.displayName}</td>
        <td>{entry.email}</td>
        <td>
          {STATUS_LABELS[entry.status]}
          {#if entry.status === 'waitlisted'}({entry.waitlistPosition}番目){/if}
        </td>
        <td>
          <a
            href={`/staff/${params.regionSlug}/${params.tournamentSlug}/entries/${entry.id}`}
          >
            詳細
          </a>
        </td>
      </tr>
    {/each}
  </tbody>
</table>
