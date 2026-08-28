<script lang="ts">
  import type {LayoutProps} from './$types';

  let {data, children}: LayoutProps = $props();
</script>

{#if data.loggedIn}
  <nav aria-label="アカウント">
    <!-- `/staff/logout` is a route of its own because the screens that need
         this button are spread across the region/tournament tree, and a
         layout cannot own an action. -->
    <form method="POST" action="/staff/logout">
      <button type="submit">ログアウト</button>
    </form>
  </nav>
{/if}

{@render children()}
