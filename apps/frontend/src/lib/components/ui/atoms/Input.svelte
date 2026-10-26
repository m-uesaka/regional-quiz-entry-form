<!--
@component
## 概要
- 1行のテキストを入力する際に使用されるコンポーネントです

## 機能
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- type: inputのtypeを指定できます
- placeholder: プレースホルダーの文言を指定できます
- isError: true の場合エラー時のスタイルを適用します
- readonly: 指定すると読み取り専用の状態です
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Input type="text" placeholder="プレースホルダー" bind:value />
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const inputVariants = cva('relative w-full min-h-10 px-2.75 py-1.75 bg-surface border rounded-md text-foreground text-sm outline-offset-2 outline-ring transition-colors [&:not(:disabled):not([readonly])]:hover:bg-accent/90 placeholder:text-muted-foreground focus-visible:outline-2', {
    variants: {
      /** type属性 */
      type: {
        text: [],
        file: ['text-muted-foreground file:px-2 file:text-foreground file:mr-0'],
      } as Partial<Record<HTMLInputTypeAttribute, string[]>>,
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 cursor-not-allowed'],
        false: [],
      },
      /** 読み取り専用かどうか */
      readonly: {
        true: ['opacity-50'],
        false: [],
      },
      /** エラーかどうか */
      isError: {
        true: ['border-destructive'],
        false: ['border-input'],
      },
    },
    compoundVariants: [
      {
        type: 'file',
        readonly: true,
        class: 'cursor-not-allowed',
      },
    ],
    defaultVariants: {
      type: 'text',
      disabled: false,
      readonly: false,
    },
  });

  export const startContentVariants = cva('absolute inset-y-0 left-0 z-10 flex items-center pr-1 pl-3 pointer-events-none m-auto align-middle', {
    variants: {
      disabled: {
        true: ['cursor-not-allowed'],
        false: [],
      },
    },
    defaultVariants: {
      disabled: false,
    },
  });

  export const endContentVariants = cva('absolute inset-y-0 right-0 z-10 flex items-center pr-3 pl-1 pointer-events-none m-auto align-middle', {
    variants: {
      disabled: {
        true: ['cursor-not-allowed'],
        false: [],
      },
    },
    defaultVariants: {
      disabled: false,
    },
  });

  export type InputVariants = VariantProps<typeof inputVariants>;

  export interface InputProps extends InputVariants, HTMLInputAttributes {
    // inputのクラスを制御する値
    inputClass?: ClassValue;
    startContent?: Snippet;
    endContent?: Snippet;
    /** クラス */
    class?: ClassValue;
  }
</script>

<script lang="ts">
  let {
    isError = false,
    class: className,
    inputClass,
    value = $bindable(''),
    startContent,
    endContent,
    ...inputAttributes
  }: InputProps = $props();

  let inputElement = $state<HTMLInputElement>();
  let startContentElement = $state<HTMLElement>();
  let endContentElement = $state<HTMLElement>();

  // 左側にコンテンツが来る場合の余白
  let inputLeftPadding = $derived.by(() => {
    if (startContentElement) {
      return startContentElement.clientWidth;
    }
  });

  // 右側にコンテンツが来る場合の余白
  let inputRightPadding = $derived.by(() => {
    if (endContentElement) {
      return endContentElement.clientWidth;
    }
  });

  // Local change to the upstream component, which always rendered
  // `padding-left: undefinedpx; ...`: only override Tailwind's padding when
  // there is start/end content to make room for.
  let inputPaddingStyle = $derived(
    [
      inputLeftPadding !== undefined ? `padding-left: ${inputLeftPadding}px` : '',
      inputRightPadding !== undefined ? `padding-right: ${inputRightPadding}px` : '',
    ].filter(Boolean).join('; ') || undefined,
  );

  let inputVariantClass = $derived(inputVariants({
    type: inputAttributes.type,
    disabled: inputAttributes.disabled,
    readonly: inputAttributes.readonly,
    class: inputClass,
    isError,
  }));

  let startContentVariantClass = $derived(startContentVariants({ disabled: inputAttributes.disabled }));

  let endContentVariantClass = $derived(endContentVariants({ disabled: inputAttributes.disabled }));

  // 動的に挿入された場合でも autofocus を有効にする
  $effect(() => {
    if (inputAttributes.autofocus && inputElement) {
      inputElement.focus();
    }
  });
</script>

<div class={[className, 'relative z-0 inline-block']} data-rabee-ui="input">
  {#if startContent}
    <div class={startContentVariantClass} bind:this={startContentElement}>
      <div class="contents pointer-events-auto">{@render startContent()}</div>
    </div>
  {/if}

  <input class={inputVariantClass} {...inputAttributes} bind:value bind:this={inputElement} style={inputPaddingStyle} />

  {#if endContent}
    <div class={endContentVariantClass} bind:this={endContentElement}>
      <div class="contents pointer-events-auto">{@render endContent()}</div>
    </div>
  {/if}
</div>

<style>
  /* autofill用の考慮 */
  input:-webkit-autofill {
    box-shadow: 0 0 0 1000px rgb(255, 255, 255) inset !important;
    -webkit-text-fill-color: #18181b !important;
  }

  .dark input:-webkit-autofill {
    box-shadow: 0 0 0 1000px rgb(0, 9, 11) inset !important;
    -webkit-text-fill-color: #fafafa !important;
  }
</style>

      
