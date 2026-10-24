<script lang="ts">
  import SubNav from '$lib/components/layout/SubNav.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import type {LayoutProps} from './$types';

  const {children}: LayoutProps = $props();
</script>

<!-- The management screens have no other way in: nothing links to
     `/admin/regions`, `/admin/staff` or `/admin/tournaments` from the
     participant- or staff-facing trees, so the entry point lives on the
     layout they all share. -->
<SubNav label="管理メニュー">
  <ul class="flex flex-wrap items-center gap-x-4 gap-y-1">
    <li><Link href="/admin/regions" variant="secondary">地域</Link></li>
    <li><Link href="/admin/staff" variant="secondary">スタッフ</Link></li>
    <li><Link href="/admin/tournaments" variant="secondary">大会</Link></li>
    <li>
      <Link href="/admin/tournaments/new" variant="secondary">大会を作成</Link>
    </li>
  </ul>
</SubNav>

{@render children()}
