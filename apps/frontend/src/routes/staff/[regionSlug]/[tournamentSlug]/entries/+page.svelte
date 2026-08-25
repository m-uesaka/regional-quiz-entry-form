<script lang="ts">
  import {ENTRY_STATUS_LABELS} from '@regional-quiz/shared';
  import type {PageProps} from './$types';

  let {data, params}: PageProps = $props();

  // A plain link rather than a `fetch`: the export is served from the same
  // origin as this page, so the browser sends the `staff_session` cookie
  // the endpoint authorizes against, and the response's
  // `Content-Disposition` triggers the download.
  const csvHref = $derived(
    `/api/staff/tournaments/${data.tournament.id}/entries.csv`,
  );
</script>

<h1>{data.tournament.name} エントリー一覧</h1>

<p><a href={csvHref} download>CSV をダウンロード</a></p>

<table>
  <thead>
    <tr>
      <th>氏名</th>
      <th>ふりがな</th>
      <th>掲載名</th>
      <th>メールアドレス</th>
      <th>ステータス</th>
      <th>操作</th>
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
          {ENTRY_STATUS_LABELS[entry.status]}
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
