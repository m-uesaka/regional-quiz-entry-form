<script lang="ts">
  import {enhance} from '$app/forms';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();
  let turnstile = $state<ReturnType<typeof Turnstile>>();
</script>

<h1>パスワード再設定</h1>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

{#if data.hasToken}
  <p>新しいパスワードを入力してください。</p>

  <form method="POST" use:enhance>
    <div class="form-field">
      <label for="newPassword">新しいパスワード</label>
      <input
        id="newPassword"
        name="newPassword"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
      />
    </div>

    <div class="form-field">
      <label for="newPasswordConfirm">新しいパスワード(確認用)</label>
      <input
        id="newPasswordConfirm"
        name="newPasswordConfirm"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
      />
    </div>

    <button type="submit">パスワードを再設定する</button>
  </form>
{:else if form?.sent}
  <p role="status">
    パスワード再設定用のリンクをメールで送信しました。メールをご確認ください。
  </p>
{:else}
  <p>
    ご登録のメールアドレスを入力してください。パスワード再設定用のリンクを送信します。
  </p>

  <!-- The `enhance` callback is only here to hand the challenge back: a
       refusal is reported with `fail()`, which re-renders this form in
       place with the token it already spent still in it, so the retry the
       message invites would fail the challenge rather than whatever it was
       actually refused for. See `Turnstile.svelte`. -->
  <form
    method="POST"
    use:enhance={() => {
      return async ({update}) => {
        await update();
        turnstile?.reset();
      };
    }}
  >
    <div class="form-field">
      <label for="email">メールアドレス</label>
      <input
        id="email"
        name="email"
        type="email"
        autocomplete="email"
        required
      />
    </div>

    <!-- Only this half of the flow is behind the challenge: it mails a link
         to whatever address is typed in, while the form above is reached
         only with a token that was already mailed to the account's own
         address (#116). -->
    <Turnstile bind:this={turnstile} />

    <button type="submit">再設定用リンクを送信する</button>
  </form>
{/if}

<a href="/mypage/login">ログイン画面へ戻る</a>
