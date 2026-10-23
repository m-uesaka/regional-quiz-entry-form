<!--
@component
## 概要
- ユーザーに重要な情報や通知を伝えるためのコンポーネントです

## 機能
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- variant: 通知の意味を指定すると、それに合わせたスタイルになります

## Usage
```svelte
  <Message variant="default">
    <div class="flex flex-col">
      <Label class="font-medium leading-tight !text-base mb-1.5">ラベル</Label>
      <p class="text-foreground text-sm">ここに補足文が入ります。</p>
    </div>
  </Message>
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const messageVariants = cva('flex items-start w-full gap-3 p-4 border rounded-lg', {
    variants: {
      /** 通知の使用用途 */
      variant: {
        danger: ['bg-destructive/10 border-destructive'],
        warning: ['bg-warning/10 border-warning'],
        success: ['bg-success/10 border-success'],
        default: ['bg-primary/10 border-primary'],
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  });

  export const messageIconVariants = cva('', {
    variants: {
      variant: {
        danger: ['text-destructive'],
        warning: ['text-warning'],
        success: ['text-success'],
        default: ['text-primary'],
      },
    },
    // Local change to the upstream component, which nested this inside
    // `variants`, where cva reads it as a variant named `defaultVariants`.
    defaultVariants: {
      variant: 'default',
    },
  });

  export type MessageVariants = VariantProps<typeof messageVariants>;

  export interface MessageProps extends MessageVariants {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
  }
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { variant, class: className, children }: MessageProps = $props();

  let messageVariantClass = $derived(messageVariants({ class: className, variant }));

  let messageIconVariantClass = $derived(messageIconVariants({ variant }));
</script>

<div class={messageVariantClass} data-rabee-ui="message">
  <div class={messageIconVariantClass}>
    {#if variant === 'danger'}
      <CircleAlert size="1rem" />
    {:else if variant === 'warning'}
      <TriangleAlert size="1rem" />
    {:else if variant === 'success'}
      <Check size="1rem" />
    {:else}
      <Info size="1rem" />
    {/if}
  </div>
  {@render children?.()}
</div>

      
