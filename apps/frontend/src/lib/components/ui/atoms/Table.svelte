<!--
@component
## 概要
- tableタグと同様に表形式のデータを表示するための汎用的なテーブルコンポーネントです

## 機能
- tableタグと同様に行・列で構造化されたデータを表示可能です
- 任意のテーブル要素（`<thead>`, `<tbody>`, `<tr>` など）を自由に記述可能です

## Usage
```svelte
  <Table>
    <tr>などを自由に記載
  </Table>
```
-->

<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLTableAttributes } from 'svelte/elements';

  export interface TableProps extends HTMLTableAttributes {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  let { class: className, children, ...tableAttributes }: TableProps = $props();
</script>

<table class={className} {...tableAttributes} data-rabee-ui="table">
  {@render children?.()}
</table>

      
