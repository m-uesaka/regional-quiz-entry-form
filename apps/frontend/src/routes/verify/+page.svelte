<script lang="ts">
  import {enhance} from '$app/forms';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button, {
    buttonVariants,
  } from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';
  let {data, form}: PageProps = $props();

  // Pressed twice, the second request would find the token already spent
  // and its "invalid" could be the answer the page ends up showing, so the
  // button stays disabled until the first answer arrives. `pageshow` resets
  // it when the page comes back from the bfcache mid-request.
  let submitting = $state(false);
</script>

<svelte:window
  onpageshow={() => {
    submitting = false;
  }}
/>

<PageContainer>
  <PageHeader title="エントリーの確認" />

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  {#if data.status === 'ready'}
    <!-- Opening the link only gets the participant this far: a mail scanner
         fetching it never presses the button, so it confirms nothing (#190).
         The token stays in an httpOnly cookie the action reads. -->
    <Card class="gap-4">
      <p class="text-sm">
        下のボタンを押すと、エントリーが確定します。このエントリーに心当たりがない場合は、ボタンを押さずにこのページを閉じてください。
      </p>
      <form
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({update}) => {
            await update();
            submitting = false;
          };
        }}
      >
        <Button
          type="submit"
          variant="primary"
          tone="solid"
          class="w-full"
          disabled={submitting}
        >
          {submitting ? '確定しています…' : 'エントリーを確定する'}
        </Button>
      </form>
    </Card>
  {:else if data.status === 'confirmed'}
    <Message variant="success">
      <div class="flex flex-col gap-1 text-sm">
        <p class="font-semibold">エントリーが確定しました。</p>
        <p>大会当日の詳細は、後日あらためてご連絡します。</p>
      </div>
    </Message>
  {:else if data.status === 'waitlisted'}
    <Message variant="warning">
      <div class="flex flex-col gap-1 text-sm">
        <p class="font-semibold">
          定員に達していたため、キャンセル待ちになりました。
        </p>
        <!-- The position isn't in this endpoint's response; mypage lists it
             alongside the entry, so that's where the participant is sent for it. -->
        <p>キャンセル待ちの順位はマイページから確認できます。</p>
        <p>空きが出た場合は、順番に繰り上げのうえご連絡します。</p>
      </div>
    </Message>
  {:else}
    <Message variant="danger">
      <div class="flex flex-col gap-1 text-sm">
        <p class="font-semibold">この確認リンクは無効です。</p>
        <p>
          リンクの有効期限(24時間)が切れているか、すでに使用済みの可能性があります。
        </p>
        <!-- Which tournament the token belonged to isn't recoverable from an
             invalid token, so re-entry is guided through mypage rather than a
             direct link to the entry form. An entry left pending by an expired
             link is cancelled by the participant's next entry
             (`lapse_expired_pending_entries()`, #172), so entering again is
             all it takes. -->
        <p>
          すでにエントリーが確定している場合もあるため、まずはマイページにログインしてエントリー状況をご確認ください。エントリーが確定していない場合は、大会のエントリーフォームからもう一度エントリーしてください。期限切れで確定しなかったエントリーは、もう一度エントリーすると取り消され、新しい確認メールが届きます。
        </p>
      </div>
    </Message>
  {/if}

  {#if data.status !== 'ready'}
    <Card class="gap-3">
      <p>
        <a
          href="/mypage"
          class={buttonVariants({variant: 'primary', tone: 'solid', size: 'medium'})}
          >マイページへ</a
        >
      </p>
      <!-- Entry creation doesn't start a participant session, so a participant
           arriving from the confirmation mail is usually logged out and will be
           sent to /mypage/login first. -->
      <p class="text-sm text-muted-foreground">
        マイページの閲覧にはログインが必要です。ログインしていない場合はログイン画面に移動します。
      </p>
    </Card>
  {/if}
</PageContainer>
