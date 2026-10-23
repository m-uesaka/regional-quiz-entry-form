<!--
@component
## 概要
- セクション間の区切り線（セパレーター）を表示するためのコンポーネントです

## 機能
- directionに応じて、横または縦の区切り線を表示します

## Props
- direction: 方向を指定すると、それに合わせたスタイルが適用されます

## Usage
```svelte
<Separator direction="horizontal" />
<Separator direction="vertical" />
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const separatorVariants = cva('bg-border', {
    variants: {
      /** セパレーターの方向 */
      direction: {
        horizontal: ['w-full h-px'],
        vertical: ['w-px h-full'],
      },
    },
    defaultVariants: {
      direction: 'horizontal',
    },
  });

  export type SeparatorVariants = VariantProps<typeof separatorVariants>;

  export interface SeparatorProps extends SeparatorVariants {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
  }
</script>

<script lang="ts">
  let { direction, class: className }: SeparatorProps = $props();

  let separatorVariantClass = $derived(separatorVariants({ direction, class: className }));
</script>

<div class={separatorVariantClass} data-rabee-ui="separator"></div>

      
