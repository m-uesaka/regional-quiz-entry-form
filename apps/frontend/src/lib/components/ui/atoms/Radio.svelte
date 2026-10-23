<!--
@component
## 概要
- inputタグ radio のように、クリックなどのユーザー操作に対応する汎用的なボタンコンポーネントです

## 機能
- groupバインディングによる選択状態を共有します
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- isError: true の場合エラー時のスタイルを適用します
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Radio name="radio_name" value="radio_value" />
```
-->

<script module lang="ts">
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const radioBorderVariants = cva('size-4 border rounded-full outline-ring transition-shadow peer-focus-visible:hover:outline-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:hover:outline-ring peer-focus-visible:outline-ring peer-focus-visible:hover:ring-2 peer-focus-visible:hover:ring-ring/20', {
    variants: {
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 pointer-events-none'],
        false: ['cursor-pointer group-hover:ring-4 hover:ring-4 group-hover:ring-ring/20 hover:ring-ring/20'],
      },
      /** エラーかどうか */
      isError: {
        true: ['border-destructive'],
        false: ['border-input'],
      },
    },
  });

  export const radioCircleVariants = cva('absolute inset-[0.1875rem] size-2.5 rounded-full scale-0 peer-checked:pointer-events-none peer-checked:scale-100', {
    variants: {
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 pointer-events-none'],
        false: ['cursor-pointer'],
      },
      /** エラーかどうか */
      isError: {
        true: ['bg-destructive'],
        false: ['bg-primary'],
      },
    },
  });

  export type RadioVariants = VariantProps<typeof radioCircleVariants>;

  export interface RadioProps extends RadioVariants, HTMLInputAttributes {
    /** グループ */
    group?: any;
    /** 値 */
    value?: any;
    /** クラス */
    class?: ClassValue;
  }
</script>

<script lang="ts">
  let { group = $bindable(), isError = false, disabled = false, class: className, ...inputAttributes }: RadioProps = $props();

  let radioBorderVariantClass = $derived(radioBorderVariants({ disabled, isError }));

  let radioCircleVariantClass = $derived(radioCircleVariants({ disabled, isError }));
</script>

<label class={[className, 'relative block size-fit']} data-rabee-ui="radio">
  <input class="sr-only peer" type="radio" bind:group {disabled} {...inputAttributes} />
  <div class={radioBorderVariantClass}></div>
  <div class={radioCircleVariantClass}></div>
</label>

      
