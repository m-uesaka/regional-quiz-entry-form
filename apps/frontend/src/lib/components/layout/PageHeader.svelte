<!--
@component
The heading block at the top of a page: an `<h1>`, an optional lead
paragraph, and optional actions (buttons, links) aligned to the right.
-->
<script lang="ts">
  import type {Snippet} from 'svelte';

  interface Props {
    title: string;
    description?: string;
    actions?: Snippet;
  }

  const {title, description, actions}: Props = $props();
</script>

<div class="flex flex-wrap items-end justify-between gap-4">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-bold leading-tight">{title}</h1>
    {#if description}
      <p class="text-sm text-muted-foreground">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
