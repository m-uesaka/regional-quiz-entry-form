<!--
@component
## 概要
- textareaタグと同様に複数行のテキストを入力する際に使用されるコンポーネントです

## 機能
- 複数行のプレーンテキスト編集が可能です
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- isError: true の場合エラー時のスタイルを適用します
- readonly: 指定すると読み取り専用の状態です
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Textarea placeholder="プレースホルダー" bind:value />
```
-->

<script module lang="ts">
  import type { ClassValue, HTMLTextareaAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const textareaVariants = cva('w-full min-h-20 px-3 py-2 bg-surface border rounded-md text-foreground text-sm outline-offset-2 outline-ring transition-colors [&:not(:disabled):not([readonly])]:hover:bg-accent/90 placeholder:text-muted-foreground focus-visible:outline-2', {
    variants: {
      /** エラーかどうか */
      isError: {
        true: ['border-destructive'],
        false: ['border-input'],
      },
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 cursor-not-allowed'],
        false: ['cursor-text'],
      },
      /** 読み取り専用かどうか */
      readonly: {
        true: ['opacity-50'],
        false: [],
      },
    },
    defaultVariants: {
      isError: false,
      disabled: false,
      readonly: false,
    },
  });

  export type TextareaVariants = VariantProps<typeof textareaVariants>;

  export interface TextareaProps extends TextareaVariants, HTMLTextareaAttributes {
    /** クラス */
    class?: ClassValue;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  let {
    isError = false,
    disabled = false,
    readonly = false,
    class: className,
    value = $bindable(''),
    ...textareaAttributes
  }: TextareaProps = $props();

  let textareaElement = $state<HTMLTextAreaElement>();

  let textareaVariantClass = $derived(textareaVariants({ disabled, readonly, isError, class: className }));

  // 動的に挿入された場合でも autofocus を有効にする
  $effect(() => {
    if (textareaAttributes.autofocus && textareaElement) {
      textareaElement.focus();
    }
  });
</script>

<textarea class={textareaVariantClass} {disabled} {readonly} {...textareaAttributes} bind:value bind:this={textareaElement} data-rabee-ui="textarea"></textarea>

      
