<script lang="ts">
  import type {LayoutProps} from './$types';

  let {data, children}: LayoutProps = $props();
</script>

{#if data.loggedIn}
  <nav aria-label="アカウント">
    <!-- Posted to `/mypage`'s action rather than this layout's own, which
         layouts cannot have. The absolute path is what lets the nested
         entry-edit screens share the one button. -->
    <form method="POST" action="/mypage?/logout">
      <button type="submit">ログアウト</button>
    </form>
  </nav>
{/if}

{@render children()}
