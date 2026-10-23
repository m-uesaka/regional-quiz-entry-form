<!--
@component
## 概要
- ラベルやステータスなどの短い情報を表示するためのコンポーネントです
- 必要に応じて、リンクやボタンとしてナビゲーションやフィルターUIなど幅広い用途に対応します

## 機能
- クリックやフォーカスなどのインタラクションに対応します
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- variant: チップの色を指定します
- tone: 塗りのスタイルを指定します
- link: ボタンやリンクスタイルに適用可能です

## Usage
```svelte
// チップ
<Chip variant="primary" tone="filled">チップ</Chip>
// リンク
<a href="/" class={chipVariants({ variant: 'primary', tone: 'filled', link: true })}>チップ</a>
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const chipVariants = cva('inline-flex items-center w-fit rounded-full font-semibold text-xs/none outline-ring outline-offset-2 focus-visible:outline-2', {
    variants: {
      /** チップの使用用途 */
      variant: {
        primary: [],
        secondary: [],
        success: [],
        warning: [],
        danger: [],
      },
      /** チップの塗りの値 */
      tone: {
        filled: ['px-2.5 py-1'],
        outlined: ['px-[0.5625rem] py-[0.1875rem]'],
        soft: ['px-2.5 py-1'],
      },
      /** リンク */
      link: {
        true: ['cursor-pointer'],
        false: [],
      },
    },
    compoundVariants: [
      {
        variant: 'primary',
        tone: 'filled',
        class: 'bg-primary border border-primary text-primary-foreground',
      },
      {
        variant: 'primary',
        tone: 'outlined',
        class: 'border border-primary text-foreground',
      },
      {
        variant: 'primary',
        tone: 'soft',
        class: 'bg-primary/10 border border-transparent text-primary',
      },
      {
        variant: 'secondary',
        tone: 'filled',
        class: 'bg-inverse border border-inverse text-inverse-foreground',
      },
      {
        variant: 'secondary',
        tone: 'outlined',
        class: 'border border-border text-foreground',
      },
      {
        variant: 'secondary',
        tone: 'soft',
        class: 'bg-muted border border-transparent text-foreground',
      },
      {
        variant: 'success',
        tone: 'filled',
        class: 'bg-success border border-success text-success-foreground',
      },
      {
        variant: 'success',
        tone: 'outlined',
        class: 'border border-success text-foreground',
      },
      {
        variant: 'success',
        tone: 'soft',
        class: 'bg-success/10 border border-transparent text-success',
      },
      {
        variant: 'warning',
        tone: 'filled',
        class: 'bg-warning border border-warning text-warning-foreground',
      },
      {
        variant: 'warning',
        tone: 'outlined',
        class: 'border border-warning text-foreground',
      },
      {
        variant: 'warning',
        tone: 'soft',
        class: 'bg-warning/10 border border-transparent text-foreground',
      },
      {
        variant: 'danger',
        tone: 'filled',
        class: 'bg-destructive border border-destructive text-destructive-foreground',
      },
      {
        variant: 'danger',
        tone: 'outlined',
        class: 'border border-destructive text-foreground',
      },
      {
        variant: 'danger',
        tone: 'soft',
        class: 'bg-destructive/10 border border-transparent text-destructive',
      },
      {
        variant: 'primary',
        tone: 'filled',
        link: true,
        class: 'transition-colors active:bg-primary/80 hover:bg-primary/90 hover:border-primary/10 active:border-primary/80',
      },
      {
        variant: 'secondary',
        tone: 'filled',
        link: true,
        class: 'transition-colors active:bg-inverse/80 hover:bg-inverse/90',
      },
      {
        variant: 'success',
        tone: 'filled',
        link: true,
        class: 'transition-colors active:bg-success/80 hover:bg-success/90 hover:border-success/10 active:border-success/80',
      },
      {
        variant: 'warning',
        tone: 'filled',
        link: true,
        class: 'transition-colors active:bg-warning/80 hover:bg-warning/90 hover:border-warning/10 active:border-warning/80',
      },
      {
        variant: 'danger',
        tone: 'filled',
        link: true,
        class: 'transition-colors active:bg-destructive/80 hover:bg-destructive/90 hover:border-destructive/10 active:border-destructive/80',
      },
      {
        tone: 'outlined',
        link: true,
        class: 'transition-colors active:bg-accent/80 hover:bg-accent/90',
      },
      {
        tone: 'soft',
        link: true,
        class: 'transition-colors hover:bg-accent active:bg-muted',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      tone: 'filled',
      link: false,
    },
  });

  export type ChipVariants = VariantProps<typeof chipVariants>;

  export interface ChipProps extends ChipVariants {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
  }
</script>

<script lang="ts">
  let { tone, link, variant, class: className, children }: ChipProps = $props();

  let chipVariantClass = $derived(chipVariants({ tone, link, variant, class: className }));
</script>

<div class={chipVariantClass} data-rabee-ui="chip">
  {@render children?.()}
</div>

      
