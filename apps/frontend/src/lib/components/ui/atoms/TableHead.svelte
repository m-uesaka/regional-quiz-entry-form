<!--
@component
## 概要
- thタグのように、テーブルのヘッダーセルを表す汎用的なコンポーネントです

## 機能
- thタグとして動作し、テーブルのヘッダーセルとして使用できます

## Props
- size: セルのサイズを指定できます

## Usage
```svelte
<Table>
  <tbody>
    <tr>
      <TableHead size="s">テーブルデータ</TableHead>
    </tr>
  </tbody>
</Table>
```
-->
<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLThAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const tableHeadVariants = cva('px-4 py-1 text-left font-medium text-muted-foreground text-sm/tight transition-colors', {
    variants: {
      /** セルのサイズ */
      size: {
        small: ['h-12'],
        medium: ['h-18'],
        large: ['h-24'],
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  });

  export type TableVariants = VariantProps<typeof tableHeadVariants>;

  export interface TableHeadProps extends TableVariants, HTMLThAttributes {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  let { size, children, class: className, ...thAttributes }: TableHeadProps = $props();

  let thVariantClass = $derived(tableHeadVariants({ size, class: className }));
</script>

<th class={thVariantClass} {...thAttributes} data-rabee-ui="table-head">
  {@render children?.()}
</th>

      
