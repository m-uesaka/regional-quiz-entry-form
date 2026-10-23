<!--
@component
## 概要
- ユーザーが複数の選択肢から1つ以上を選択できるコンポーネントです

## 機能
- checkboxタグと同様に bind:group が使用できます
- 見た目を変更するためのいくつかのスタイル用Propsが追加されています(詳細はPropsセクションを参照)

## Props
- isError: true の場合エラー時のスタイルを適用します
- disabled: 指定するとグレーアウトされ、クリック不可になります
- indeterminate: 一部のみ選択された状態や、不確定な状態です

## Usage
```svelte
<Checkbox bind:checked />
```
-->

<script module lang="ts">
  import type { ClassValue, HTMLInputAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const checkboxBorderVariants = cva('relative size-4 border rounded-xs outline-ring/20 transition-shadow peer-focus-visible:hover:outline-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:hover:outline-ring peer-focus-visible:outline-ring peer-focus-visible:hover:ring-2 peer-focus-visible:hover:ring-ring/20', {
    variants: {
      /** 操作できるかどうか */
      disabled: {
        true: ['bg-muted opacity-50 pointer-events-none'],
        false: ['cursor-pointer group-hover:ring-4 hover:ring-4 group-hover:ring-ring/20 hover:ring-ring/20'],
      },
      /** エラーかどうか */
      isError: {
        true: ['border-destructive'],
        false: ['border-input'],
      },
    },
  });

  export const checkboxIconVariants = cva('absolute top-0 size-4 rounded-xs text-bright-foreground pointer-events-none scale-0 transition-shadow peer-checked:scale-100', {
    variants: {
      /** 操作できるかどうか */
      disabled: {
        true: ['bg-muted opacity-50'],
        false: [],
      },
      /** エラーかどうか */
      isError: {
        true: ['bg-destructive'],
        false: ['bg-primary'],
      },
    },
  });

  export type CheckboxVariants = VariantProps<typeof checkboxBorderVariants>;

  export interface CheckboxProps extends CheckboxVariants, HTMLInputAttributes {
    /** クラス */
    class?: ClassValue;
    /** チェックしているかどうか */
    checked?: boolean;
    /** グループ */
    group?: any[];
    /** 値 */
    value?: any;
    /** 不確定な要素かどうか */
    indeterminate?: boolean;
  }

  // for bind:group
  const groupSetMap = new WeakMap<any[], Set<any>>();

  function getGroupSet(group: any[]): Set<any> {
    let set = groupSetMap.get(group);
    if (!set) {
      set = new Set(group);
      groupSetMap.set(group, set);
    }
    return set;
  }
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Minus from '@lucide/svelte/icons/minus';
  import { untrack } from 'svelte';

  let {
    class: className,
    checked = $bindable(false),
    group = $bindable(),
    indeterminate = false,
    isError = false,
    disabled = false,
    value,
    ...inputAttributes
  }: CheckboxProps = $props();

  let checkboxBorderVariantClass = $derived(checkboxBorderVariants({ disabled, isError }));

  let checkboxIconVariantClass = $derived(checkboxIconVariants({ disabled, isError }));

  $effect(() => {
    if (group) {
      const set = getGroupSet(group);
      checked = set.has(value);
    }
  });

  $effect(() => {
    // watch `checked`
    checked;
    untrack(() => {
      if (group) {
        const set = getGroupSet(group);

        // skip
        if (set.has(value) === checked) return;

        if (checked) {
          set.add(value);
        }
        else {
          set.delete(value);
        }

        // update group
        group = [...set.values()];
      }
    });
  });
</script>

<label class={[className, 'relative block size-fit']} data-rabee-ui="checkbox">
  <!-- `{value}` is a local change to the upstream component, which consumes
       `value` for `group` and never puts it on the input: a natively posted
       form then submits "on" instead of the value. -->
  <input class="sr-only peer" type="checkbox" {disabled} {value} {...inputAttributes} bind:checked />
  <div class={checkboxBorderVariantClass}></div>
  {#if indeterminate}
    <Minus class={checkboxIconVariantClass} />
  {:else}
    <Check class={checkboxIconVariantClass} />
  {/if}
</label>

      
