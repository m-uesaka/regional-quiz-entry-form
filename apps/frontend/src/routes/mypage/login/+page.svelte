<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();

  // Seeded from the action result once, then owned by the field itself. See
  // "Form controls are bound, not rendered from an expression" in
  // `apps/frontend/README.md` for why this isn't `value={form?.email ?? ''}`.
  let email = $state(untrack(() => form?.email ?? ''));
</script>

<h1>マイページ ログイン</h1>

{#if data.passwordReset}
  <p role="status">
    パスワードを再設定しました。新しいパスワードでログインしてください。
  </p>
{/if}

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

<form method="POST" use:enhance>
  <div class="form-field">
    <label for="email">メールアドレス</label>
    <input
      id="email"
      name="email"
      type="email"
      bind:value={email}
      autocomplete="email"
      required
    />
  </div>

  <div class="form-field">
    <label for="password">パスワード</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
    />
  </div>

  <button type="submit">ログイン</button>
</form>

<a href="/password-reset">パスワードを忘れた方はこちら</a>
