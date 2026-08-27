<script lang="ts">
  import type {PageProps} from './$types';

  let {form}: PageProps = $props();
</script>

<h1>スタッフログイン</h1>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

<!-- No `action` and no `use:enhance`: posting to the current URL keeps the
     `redirectTo` query parameter that `staffLoginPath()` attached, and a
     plain form submit means the screen works before (or without) the client
     bundle. -->
<form method="POST">
  <label>
    メールアドレス
    <input
      type="email"
      name="email"
      value={form?.email ?? ''}
      required
      autocomplete="username"
    />
  </label>
  <label>
    パスワード
    <input
      type="password"
      name="password"
      required
      autocomplete="current-password"
    />
  </label>
  <button type="submit">ログイン</button>
</form>
