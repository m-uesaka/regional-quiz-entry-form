<!--
@component
The bar under the site header that each area (staff, admin, mypage) uses for
its own navigation and account actions. Pass the links as `children` and the
right-hand side (e.g. a logout form) as `actions`.
-->
<script lang="ts">
  import type {Snippet} from 'svelte';

  interface Props {
    label: string;
    children?: Snippet;
    actions?: Snippet;
  }

  const {label, children, actions}: Props = $props();
</script>

<nav aria-label={label} class="border-b border-border bg-surface">
  <div
    class="mx-auto flex min-h-12 max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2"
  >
    <div class="flex flex-wrap items-center gap-1 text-sm">
      {@render children?.()}
    </div>
    {#if actions}
      <div class="flex items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>
</nav>
