<script lang="ts">
  import SubNav from '$lib/components/layout/SubNav.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import type {LayoutProps} from './$types';

  let {data, children}: LayoutProps = $props();
</script>

{#if data.loggedIn}
  <SubNav label="アカウント">
    {#if data.isGeneralStaff}
      <Link href="/staff/dashboard" variant="secondary">ダッシュボード</Link>
    {/if}
    {#snippet actions()}
      <!-- `/staff/logout` is a route of its own because the screens that need
           this button are spread across the region/tournament tree, and a
           layout cannot own an action. -->
      <form method="POST" action="/staff/logout">
        <Button type="submit" variant="secondary" tone="ghost" size="small">
          ログアウト
        </Button>
      </form>
    {/snippet}
  </SubNav>
{/if}

{@render children()}
