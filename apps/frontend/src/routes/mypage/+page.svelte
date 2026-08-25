<script lang="ts">
  import {enhance} from '$app/forms';
  import {
    EDITABLE_ENTRY_STATUSES,
    isEntryEditable,
  } from '@regional-quiz/shared';
  import type {PageProps} from './$types';
  let {data, form}: PageProps = $props();
</script>

<h1>マイページ</h1>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

{#each data.entries as entry (entry.id)}
  <section>
    <h2>
      {entry.tournament.name}({entry.tournament.type === 'saikyoi'
        ? '最強位'
        : '新人王'})
    </h2>
    <p>ステータス: {entry.status}</p>
    <!-- The edit API refuses cancelled entries and closed entry periods, so
         the link is only offered where it would actually work. The two
         reasons are told apart here (as on the edit page) because a
         cancelled entry can still sit inside an open entry period. -->
    {#if isEntryEditable(entry)}
      <a href={`/mypage/entries/${entry.id}/edit`}>編集する</a>
    {:else if !EDITABLE_ENTRY_STATUSES.includes(entry.status)}
      <p>キャンセル済みのエントリーは編集できません</p>
    {:else}
      <p>編集期間は終了しました</p>
    {/if}
    <!-- Unlike editing, cancelling stays available after the entry period
         closes: a participant who can no longer take part should still be
         able to free their seat for the waitlist. Only an already-cancelled
         entry has nothing left to cancel. -->
    {#if entry.status !== 'cancelled'}
      <form
        method="POST"
        action="?/cancel"
        use:enhance={({cancel}) => {
          // Cancelling can't be undone from mypage — re-entering means
          // filling the entry form in again — so it is confirmed first.
          if (!window.confirm('エントリーをキャンセルします。よろしいですか?')) {
            cancel();
          }
        }}
      >
        <input type="hidden" name="entryId" value={entry.id} />
        <button type="submit">エントリーをキャンセルする</button>
      </form>
    {/if}
  </section>
{/each}
