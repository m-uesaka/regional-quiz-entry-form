<!--
@component
Centers a page's content and gives every screen the same width and padding.
`size="narrow"` is for single-form screens such as the login pages.
-->
<script lang="ts">
  import type {Snippet} from 'svelte';

  interface Props {
    size?: 'narrow' | 'default' | 'wide';
    children: Snippet;
  }

  const {size = 'default', children}: Props = $props();

  const widthClass = $derived(
    size === 'narrow' ? 'max-w-md' : size === 'wide' ? 'max-w-5xl' : 'max-w-3xl',
  );
</script>

<main class={['mx-auto flex flex-col gap-6 px-4 py-8', widthClass]}>
  {@render children()}
</main>
