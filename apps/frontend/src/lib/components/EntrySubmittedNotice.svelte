<!--
@component
What the entry form turns into once a submission has gone through: the entry
is not done until the participant follows the link in the mail, so this says
so in a heading and walks them through it rather than leaving a one-line
"sent" message above where the form used to be.

Pass `email` after an anonymous submission and leave it out after a
logged-in one. The two are worded apart because an anonymous submission is
answered the same whatever the address (#117): the mail that went out is
either the confirmation link or the reason there isn't one, so nothing here
may say the entry was taken.
-->
<script lang="ts">
  import MailCheck from '@lucide/svelte/icons/mail-check';
  import {ENTRY_VERIFICATION_TOKEN_TTL_MS} from '@regional-quiz/shared';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';

  interface Props {
    /** The address an anonymous submission was mailed to. */
    email?: string;
  }

  const {email}: Props = $props();

  const linkLifetimeHours = ENTRY_VERIFICATION_TOKEN_TTL_MS / (60 * 60 * 1000);
</script>

<Card class="gap-5">
  <div class="flex items-start gap-3">
    <MailCheck class="mt-0.5 size-7 shrink-0 text-success" aria-hidden="true" />
    <div class="flex flex-col gap-1">
      <h2 class="text-xl font-bold leading-tight">
        {email === undefined ? '確認メールを送信しました' : 'メールを送信しました'}
      </h2>
      <p role="status" class="text-sm">
        {#if email === undefined}
          エントリーを受け付けました。<strong>エントリーはまだ確定していません。</strong>
          登録済みのメールアドレス宛に送信した確認メールのリンクを開いて、エントリーを確定してください。
        {:else}
          <strong class="break-all">{email}</strong> 宛にメールを送信しました。
          <strong>エントリーの手続きはまだ完了していません。</strong>
          メールの案内に従って、手続きを進めてください。
        {/if}
      </p>
    </div>
  </div>

  <ol class="flex list-decimal flex-col gap-1 pl-6 text-sm">
    <li>届いたメールを開く</li>
    <li>
      メール内の「エントリーを確定する」のリンクを開く(有効期限はメールの送信から{linkLifetimeHours}時間)
    </li>
    <li>「エントリーが確定しました」と表示されれば完了です</li>
  </ol>

  <div class="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
    <p class="font-medium">メールが届かない場合</p>
    <ul class="flex list-disc flex-col gap-1 pl-5">
      <li>迷惑メールフォルダに振り分けられていないか確認してください</li>
      <!-- Mail goes out from a `mail.` subdomain of the site's domain
           (`staging.mail.` on staging), so allowing the domain itself
           covers every environment under a suffix-matching filter. -->
      <li>
        ドメイン指定受信などの受信拒否設定をしている場合は、「regional-quiz-project.app」からのメールを受信できるようにしてください
      </li>
      {#if email !== undefined}
        <li>
          メールアドレスに誤りがある場合は、正しいアドレスでもう一度エントリーしてください
        </li>
      {/if}
      <li>
        リンクの有効期限が切れた場合は、もう一度エントリーしてください
      </li>
    </ul>
  </div>

  <p class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
    {#if email === undefined}
      <Link href="/mypage">マイページでエントリー状況を確認する</Link>
    {/if}
    <Link href="/portal">エントリーポータルに戻る</Link>
  </p>
</Card>
