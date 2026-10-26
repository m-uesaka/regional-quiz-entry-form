<!--
@component
The handle and the up/down buttons that move one row of a list reordered
with `dragReorder()` (`$lib/drag-reorder.ts`).

The handle is for a mouse or a finger and is hidden from assistive
technology; the buttons are how the same row is moved from the keyboard or
a screen reader, and one step at a time is easier than a drag when it is a
short move. Focus stays on the pressed button as its row moves, or passes to
the other one when the row reaches the end of the list.
-->
<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import {tick} from 'svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';

  interface Props {
    /** What the row is called, for the buttons' accessible names. */
    label: string;
    /** The row's current index in the list. */
    index: number;
    /** How many rows the list has. */
    count: number;
    /** Moves the row to the given index. */
    onmove: (to: number) => void;
  }

  const {label, index, count, onmove}: Props = $props();

  let controls = $state<HTMLDivElement>();

  /**
   * Moves the row one step and keeps focus with it.
   * @param step -1 to move up, 1 to move down.
   */
  async function move(step: -1 | 1) {
    const to = index + step;
    onmove(to);
    await tick();
    const atEnd = step < 0 ? to === 0 : to === count - 1;
    // The pressed button is disabled once its row reaches the end, so focus
    // goes to the other one rather than being dropped on the page.
    const focusStep = (step < 0) === atEnd ? 'down' : 'up';
    controls
      ?.querySelector<HTMLButtonElement>(`[data-reorder-step="${focusStep}"]`)
      ?.focus();
  }
</script>

<div bind:this={controls} class="flex items-center gap-1">
  <span
    data-drag-handle
    aria-hidden="true"
    title="ドラッグして並べ替え"
    class="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground select-none [-webkit-touch-callout:none] hover:bg-accent/90 active:cursor-grabbing"
  >
    <GripVertical class="size-5" />
  </span>
  <Button
    data-reorder-step="up"
    type="button"
    variant="secondary"
    tone="ghost"
    size="small"
    isSquare
    aria-label="{label}を上へ移動"
    disabled={index === 0}
    onclick={() => move(-1)}
  >
    <ArrowUp class="size-4" aria-hidden="true" />
  </Button>
  <Button
    data-reorder-step="down"
    type="button"
    variant="secondary"
    tone="ghost"
    size="small"
    isSquare
    aria-label="{label}を下へ移動"
    disabled={index === count - 1}
    onclick={() => move(1)}
  >
    <ArrowDown class="size-4" aria-hidden="true" />
  </Button>
</div>
