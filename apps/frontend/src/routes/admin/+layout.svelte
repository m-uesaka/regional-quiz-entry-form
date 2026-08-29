<script lang="ts">
  import type {LayoutProps} from './$types';

  const {children}: LayoutProps = $props();
</script>

<!-- The three management screens have no other way in: nothing links to
     `/admin/regions` or `/admin/staff` from the participant- or staff-facing
     trees, so the entry point lives on the layout they all share. -->
<nav aria-label="管理メニュー">
  <ul>
    <li><a href="/admin/regions">地域</a></li>
    <li><a href="/admin/staff">スタッフ</a></li>
    <li><a href="/admin/tournaments/new">大会を作成</a></li>
  </ul>
</nav>

{@render children()}
