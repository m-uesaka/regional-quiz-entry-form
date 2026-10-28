<!--
@component
What the entry form turns into once a submission has gone through: the entry
is not done until the participant follows the link in the mail, so this says
so in a heading and walks them through it rather than leaving a one-line
"sent" message above where the form used to be.

The two kinds of submission are worded apart. A logged-in one has already
been checked, so its mail always carries the link. An anonymous one is
answered the same whatever the address (#117): the mail that went out is
either the confirmation link or the reason there isn't one, so nothing said
to it may assume there is a link, let alone that the entry was taken.

It takes focus as it appears, so a keyboard or screen-reader user lands on
its heading -- read out with the not-yet-confirmed paragraph it describes
itself by -- instead of on the document the vanished submit button leaves
focus to. Focusing also scrolls the heading into view, which `update()`,
keeping the scroll position of the long form it replaced, would not.
-->
<script lang="ts">
  import MailCheck from '@lucide/svelte/icons/mail-check';
  import {
    ENTRY_VERIFICATION_TOKEN_TTL_MS,
    MAIL_SENDER_DOMAIN,
    formatLinkLifetime,
  } from '@regional-quiz/shared';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';

  interface Props {
    /** Whether the submission came from the logged-in form. */
    loggedIn: boolean;
    /** The address an anonymous submission was mailed to. */
    email?: string;
  }

  const {loggedIn, email}: Props = $props();

  const linkLifetime = formatLinkLifetime(ENTRY_VERIFICATION_TOKEN_TTL_MS);
  const summaryId = $props.id();

  let heading: HTMLHeadingElement | undefined = $state();

  $effect(() => {
    heading?.focus();
  });
</script>

<Card class="gap-5">
  <div class="flex items-start gap-3">
    <MailCheck class="mt-0.5 size-7 shrink-0 text-success" aria-hidden="true" />
    <div class="flex flex-col gap-1">
      <h2
        bind:this={heading}
        tabindex="-1"
        aria-describedby={summaryId}
        class="text-xl font-bold leading-tight outline-none"
      >
        {loggedIn ? '確認メールを送信しました' : 'メールを送信しました'}
      </h2>
      <p id={summaryId} class="text-sm">
        {#if loggedIn}
          エントリーを受け付けました。<strong>エントリーはまだ確定していません。</strong>
          登録済みのメールアドレス宛に送信した確認メールのリンクを開いて、エントリーを確定してください。
        {:else}
          {#if email}
            <strong class="break-all">{email}</strong> 宛にメールを送信しました。
          {:else}
            入力されたメールアドレス宛にメールを送信しました。
          {/if}
          <strong>エントリーの手続きはまだ完了していません。</strong>
          メールの案内に従って、手続きを進めてください。
        {/if}
      </p>
    </div>
  </div>

  <ol class="flex list-decimal flex-col gap-1 pl-6 text-sm">
    {#if loggedIn}
      <li>届いたメールを開く</li>
      <li>
        メール内の「エントリーを確定する」のリンクを開く(有効期限はメールの送信から{linkLifetime})
      </li>
      <li>「エントリーが確定しました」と表示されれば完了です</li>
    {:else}
      <li>届いたメールを開く</li>
      <li>
        メールの案内に従って手続きを進める(メール内のリンクを開く場合、有効期限はメールの送信から{linkLifetime})
      </li>
    {/if}
  </ol>

  <div class="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
    <p class="font-medium">メールが届かない場合</p>
    <ul class="flex list-disc flex-col gap-1 pl-5">
      <li>迷惑メールフォルダに振り分けられていないか確認してください</li>
      <li>
        ドメイン指定受信などの受信拒否設定をしている場合は、「{MAIL_SENDER_DOMAIN}」からのメールを受信できるようにしてください
      </li>
      {#if loggedIn}
        <li>
          リンクの有効期限が切れた場合は、もう一度エントリーしてください
        </li>
      {:else}
        <li>
          メールアドレスに誤りがある場合は、正しいアドレスでもう一度エントリーしてください
        </li>
      {/if}
    </ul>
  </div>

  <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
    {#if loggedIn}
      <Link href="/mypage">マイページでエントリー状況を確認する</Link>
    {/if}
    <Link href="/portal">エントリーポータルに戻る</Link>
  </p>
</Card>
