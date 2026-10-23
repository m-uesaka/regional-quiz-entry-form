<!--
@component
## 概要
- ユーザーが現在の位置を把握しやすくするための階層型ナビゲーションコンポーネントです

## 機能
- aタグと同様に、クリックやフォーカスなどのインタラクションに対応します

## Usage
```svelte
<Breadcrumb {items} />
```
-->

<script module lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const breadcrumbVariants = cva('flex items-center w-full gap-2 p-1 leading-normal text-muted-foreground text-sm whitespace-nowrap overflow-y-scroll hidden-scrollbar');

  export const breadcrumbListVariants = cva('block text-sm outline-offset-2 outline-ring transition-colors focus-visible:rounded-xs hover:text-accent-foreground focus-visible:outline-2', {
    variants: {
      /** 現在の階層かどうか */
      current: {
        true: ['text-foreground'],
        false: [],
      },
    },
  });

  export type BreadcrumbVariants = VariantProps<typeof breadcrumbVariants>;

  export interface BreadcrumbItem {
    /** 階層のラベル */
    label: string;
    /** 階層のリンク */
    link: string;
  }

  export interface BreadcrumbProps extends BreadcrumbVariants {
    /** ページのリスト */
    items: BreadcrumbItem[];
    /** クラス */
    class?: ClassValue;
  }
</script>

<script lang="ts">
  import Slash from '@lucide/svelte/icons/slash';

  let { items, class: className }: BreadcrumbProps = $props();

  let breadcrumbVariantClass = $derived(breadcrumbVariants({ class: className }));
</script>

<nav data-rabee-ui="breadcrumb">
  <ol class={breadcrumbVariantClass}>
    {#each items as item, i}
      <li>
        <a class={breadcrumbListVariants({ current: i === items.length - 1 })} href={item.link}>{item.label}</a>
      </li>
      {#if i < items.length - 1}
        <li>
          <Slash size="1rem" />
        </li>
      {/if}
    {/each}
  </ol>
</nav>

<style>
  .hidden-scrollbar {
    /* IE, Edge 対応 */
    -ms-overflow-style: none;
    /* Firefox 対応 */
    scrollbar-width: none;
  }

  .hidden-scrollbar::-webkit-scrollbar {
    /* Chrome, Safari 対応 */
    display: none;
  }
</style>

      
