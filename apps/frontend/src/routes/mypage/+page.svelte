<script lang="ts">
  import {enhance} from '$app/forms';
  import {
    EDITABLE_ENTRY_STATUSES,
    isEntryEditable,
  } from '@regional-quiz/shared';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button, {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';
  let {data, form}: PageProps = $props();
</script>

<PageContainer>
  <PageHeader title="マイページ" />

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  {#each data.entries as entry (entry.id)}
    <section>
      <Card class="gap-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-lg font-bold">
            {entry.tournament.name}({entry.tournament.type === 'saikyoi'
              ? '最強位'
              : '新人王'})
          </h2>
          <p class="text-sm text-muted-foreground">ステータス: {entry.status}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <!-- The edit API refuses cancelled entries and closed entry periods, so
               the link is only offered where it would actually work. The two
               reasons are told apart here (as on the edit page) because a
               cancelled entry can still sit inside an open entry period. -->
          {#if isEntryEditable(entry)}
            <a
              href={`/mypage/entries/${entry.id}/edit`}
              class={buttonVariants({
                variant: 'primary',
                tone: 'solid',
                size: 'small',
              })}>編集する</a
            >
          {:else if !EDITABLE_ENTRY_STATUSES.includes(entry.status)}
            <p class="text-sm text-muted-foreground">
              キャンセル済みのエントリーは編集できません
            </p>
          {:else}
            <p class="text-sm text-muted-foreground">編集期間は終了しました</p>
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
                if (
                  !window.confirm('エントリーをキャンセルします。よろしいですか?')
                ) {
                  cancel();
                }
              }}
            >
              <input type="hidden" name="entryId" value={entry.id} />
              <Button type="submit" variant="danger" tone="ghost" size="small">
                エントリーをキャンセルする
              </Button>
            </form>
          {/if}
        </div>
      </Card>
    </section>
  {/each}
</PageContainer>
