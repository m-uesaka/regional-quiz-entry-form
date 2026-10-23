<!--
@component
## 概要
- buttonタグのように、クリックなどのユーザー操作に対応する汎用的なボタンコンポーネントです
- 色（variant）、サイズ（size）、塗り（tone）を組み合わせて見た目を柔軟に変更できます

## 機能
- buttonタグと同様に、クリックやフォーカスなどのインタラクションに対応します
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- variant: ボタンの意味を指定すると、それに合わせたスタイルになります
- tone: 塗りのスタイルを指定します
- isSquare: trueにすると正方形のボタンになります
- size: サイズを指定します
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Button variant="primary" tone="solid" size="medium">ボタン</Button>
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLButtonAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-md leading-tight text-sm outline-offset-2 outline-ring transition-colors cursor-pointer focus-visible:outline-2', {
    variants: {
      /** ボタンの使用用途 */
      variant: {
        primary: [],
        secondary: [],
        success: [],
        danger: [],
      },
      /** ボタンのサイズ */
      size: {
        small: ['min-h-9 px-3 py-2'],
        medium: ['min-h-10 px-4 py-2.5'],
        large: ['min-h-11 px-8 py-3'],
      },
      /** ボタンの塗りの値 */
      tone: {
        solid: [],
        ghost: [],
      },
      /** ボタンを正方形にするか */
      isSquare: {
        true: ['aspect-square'],
        false: [],
      },
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 !text-foreground pointer-events-none'],
        false: [],
      },
    },
    compoundVariants: [
      {
        variant: 'primary',
        tone: 'solid',
        class:
            'bg-primary border border-primary text-primary-foreground active:bg-primary/80 hover:bg-primary/90 hover:border-primary/10 active:border-primary/80',
      },
      {
        variant: 'primary',
        tone: 'ghost',
        class:
            'border border-transparent text-primary active:bg-accent/80 hover:bg-accent/90 active:border-accent/80 hover:border-accent/90',
      },
      {
        variant: 'secondary',
        tone: 'solid',
        class:
            'border border-border text-foreground active:bg-accent/80 hover:bg-accent/90',
      },
      {
        variant: 'secondary',
        tone: 'ghost',
        class:
            'border border-transparent text-foreground active:bg-accent/80 hover:bg-accent/90 active:border-accent/80 hover:border-accent/90',
      },
      {
        variant: 'success',
        tone: 'solid',
        class:
            'bg-success border border-success text-success-foreground active:bg-success/80 hover:bg-success/90 hover:border-success/10 active:border-success/80',
      },
      {
        variant: 'success',
        tone: 'ghost',
        class:
            'border border-transparent text-success active:bg-accent/80 hover:bg-accent/90 active:border-accent/80 hover:border-accent/90',
      },
      {
        variant: 'danger',
        tone: 'solid',
        class:
            'bg-destructive border border-destructive text-destructive-foreground active:bg-destructive/80 hover:bg-destructive/90 hover:border-destructive/10 active:border-destructive/80',
      },
      {
        variant: 'danger',
        tone: 'ghost',
        class:
            'border border-transparent text-destructive active:bg-accent/80 hover:bg-accent/90 active:border-accent/80 hover:border-accent/90',
      },
      {
        variant: 'primary',
        disabled: true,
        tone: 'solid',
        class: '!bg-muted !border-muted !text-foreground',
      },
      {
        variant: 'success',
        disabled: true,
        tone: 'solid',
        class: '!bg-muted !border-muted !text-foreground',
      },
      {
        variant: 'danger',
        disabled: true,
        tone: 'solid',
        class: '!bg-muted !border-muted !text-foreground',
      },
      {
        isSquare: true,
        size: 'small',
        class: '!p-2.25',
      },
      {
        isSquare: true,
        size: 'medium',
        class: '!p-2.75',
      },
      {
        isSquare: true,
        size: 'large',
        class: '!p-3.25',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      tone: 'solid',
      size: 'medium',
    },
  });

  export type ButtonVariants = VariantProps<typeof buttonVariants>;

  export interface ButtonProps extends ButtonVariants, HTMLButtonAttributes {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  let { tone, isSquare, variant, size, class: className, children, ...buttonAttributes }: ButtonProps = $props();

  let buttonVariantClass = $derived(buttonVariants({ class: className, tone, isSquare, variant, disabled: buttonAttributes.disabled, size }));
</script>

<button class={buttonVariantClass} {...buttonAttributes} data-rabee-ui="button">
  {@render children?.()}
</button>

      
