<script lang="ts">
  import {enhance} from '$app/forms';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();
</script>

<h1>スタッフパスワード設定</h1>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

{#if data.hasToken}
  <p>スタッフアカウントで使用するパスワードを入力してください。</p>

  <!-- No `action`: posting to the current URL keeps the `token` query
       parameter the mailed link carried, which is what the action reads. -->
  <form method="POST" use:enhance>
    <div class="form-field">
      <label for="newPassword">パスワード</label>
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
      <label for="newPasswordConfirm">パスワード(確認用)</label>
      <input
        id="newPasswordConfirm"
        name="newPasswordConfirm"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
      />
    </div>

    <button type="submit">パスワードを設定する</button>
  </form>
{:else}
  <p>
    このURLにはパスワード設定用のリンクが含まれていません。メールに記載されたリンクを開き直すか、管理スタッフにリンクの再発行を依頼してください。
  </p>
{/if}

<a href="/staff/login">ログイン画面へ戻る</a>
