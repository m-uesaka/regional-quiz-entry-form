<script lang="ts">
  import SubNav from '$lib/components/layout/SubNav.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import type {LayoutProps} from './$types';

  let {data, children}: LayoutProps = $props();
</script>

{#if data.loggedIn}
  <SubNav label="アカウント">
    {#snippet actions()}
      <!-- Posted to `/mypage`'s action rather than this layout's own, which
           layouts cannot have. The absolute path is what lets the nested
           entry-edit screens share the one button. -->
      <form method="POST" action="/mypage?/logout">
        <Button type="submit" variant="secondary" tone="ghost" size="small">
          ログアウト
        </Button>
      </form>
    {/snippet}
  </SubNav>
{/if}

{@render children()}
