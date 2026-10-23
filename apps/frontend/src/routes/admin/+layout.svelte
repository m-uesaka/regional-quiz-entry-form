<script lang="ts">
  import SubNav from '$lib/components/layout/SubNav.svelte';
  import type {LayoutProps} from './$types';

  const {children}: LayoutProps = $props();

  const linkClass =
    'inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
</script>

<!-- The three management screens have no other way in: nothing links to
     `/admin/regions` or `/admin/staff` from the participant- or staff-facing
     trees, so the entry point lives on the layout they all share. -->
<SubNav label="管理メニュー">
  <ul class="flex flex-wrap items-center gap-1">
    <li><a class={linkClass} href="/admin/regions">地域</a></li>
    <li><a class={linkClass} href="/admin/staff">スタッフ</a></li>
    <li><a class={linkClass} href="/admin/tournaments/new">大会を作成</a></li>
  </ul>
</SubNav>

{@render children()}
