<!--
@component
## 概要
- tdタグのようにテーブルのセルを表す汎用的なコンポーネントです

## 機能
- tdタグのように機能し、内容をスロットで柔軟に挿入できます
- セルのサイズを指定したり複数列にまたがるセルを指定するためのPropsが追加されています（詳細はPropsセクションを参照）

## Props
- size: セルのサイズを指定できます

## Usage
```svelte
<Table>
  <tbody>
    <tr>
      <TableData size="s">テーブルデータ</TableData>
    </tr>
  </tbody>
</Table>
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLTdAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const tableDataVariants = cva('px-4 py-1 text-foreground text-sm/normal transition-colors', {
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

  export type TableDataVariants = VariantProps<typeof tableDataVariants>;

  export interface TableDataProps extends TableDataVariants, HTMLTdAttributes {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  let { size, class: className, children, ...tdAttributes }: TableDataProps = $props();

  let tdVariantClass = $derived(tableDataVariants({ size, class: className }));
</script>

<td class={tdVariantClass} {...tdAttributes} data-rabee-ui="table-data">
  {@render children?.()}
</td>

      
