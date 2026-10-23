<!--
@component
## 概要
- テキスト入力欄や選択肢などのフォーム要素に対して、その内容を明示するために使用されるコンポーネントです

## 機能
- フォーム要素と関連付けることでアクティブ化することができます
- 任意の属性を渡せます

## Props
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Label for="forName">ラベル</Label>
```
-->
<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLLabelAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const labelVariants = cva('inline-flex items-center w-fit font-medium text-foreground text-sm/tight', {
    variants: {
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 !cursor-default'],
        false: [],
      },
    },
    defaultVariants: {
      disabled: false,
    },
  });

  export type LabelVariants = VariantProps<typeof labelVariants>;

  export interface LabelProps extends LabelVariants, HTMLLabelAttributes {
    /** 必須かどうか */
    required?: boolean;
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  let { disabled = false, class: className, children, required = false, ...labelAttributes }: LabelProps = $props();

  let labelVariantClass = $derived(labelVariants({ class: className, disabled }));
</script>

<label class={labelVariantClass} {...labelAttributes} data-rabee-ui="label">
  {@render children?.()}{#if required}<span class="inline-block px-1.5 py-0.5 bg-destructive text-white text-xs/none ml-2">必須</span>{/if}
</label>

      
