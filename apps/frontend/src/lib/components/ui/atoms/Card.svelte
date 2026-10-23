<!--
@component
## 概要
- 情報をグループ化して表示するためのコンポーネントです

## 機能
- 枠線でグループ化して表示することができます
- 任意のコンテンツを配置できます

## Usage
```svelte
<Card>
  <p>カードの中身</p>
</Card>
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';
  import { twMerge } from 'tailwind-merge';

  export const cardVariants = cva('flex flex-col gap-6 p-6 bg-surface border border-border rounded-lg shadow-xs');

  export type CardVariants = VariantProps<typeof cardVariants>;

  export interface CardProps extends CardVariants {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
  }
</script>

<script lang="ts">
  let { class: className, children }: CardProps = $props();

  // Local change to the upstream component: cva only concatenates the
  // caller's `class`, so `gap-4` would sit next to the base `gap-6` and lose.
  // `twMerge` lets the caller's utility replace the conflicting base one.
  let cardVariantsClass = $derived(twMerge(cardVariants({ class: className })));
</script>

<div class={cardVariantsClass} data-rabee-ui="card">
  {@render children?.()}
</div>

      
