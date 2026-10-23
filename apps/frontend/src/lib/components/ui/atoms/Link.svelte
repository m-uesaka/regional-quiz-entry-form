<!--
@component
## 概要
- テキストリンクを表示するコンポーネントです
- `target="_blank"` を指定すると External アイコンを右に表示し、`rel="noopener noreferrer"` を自動付与します

## 機能
- aタグと同様に、クリックやフォーカスなどのインタラクションに対応します
- 外部リンク（`target="_blank"`）時に External アイコンを自動表示します
- `target="_blank"` 時は `rel="noopener noreferrer"` を自動付与します
- 見た目を変更するためのスタイル用Propsが追加されています（詳細はPropsセクションを参照してください）
- 任意の属性を渡せます

## Props
- variant: リンクの色を指定します。（`primary` | `secondary`）
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Link href="https://example.com">リンク</Link>
<Link href="https://example.com" target="_blank">外部リンク</Link>
<Link href="https://example.com" variant="secondary">リンクテキスト</Link>
<Link href="https://example.com" disabled>リンクテキスト</Link>
```
-->
<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue, HTMLAnchorAttributes } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  export const linkVariants = cva('inline-flex items-center gap-1 underline underline-offset-2 outline-offset-2 outline-ring hover:no-underline active:no-underline transition-colors focus-visible:outline-2 focus-visible:rounded-md', {
    variants: {
      /** リンクの色 */
      variant: {
        primary: ['text-link hover:text-link/90 active:text-link/80 visited:text-link-visited visited:hover:text-link-visited/90 visited:active:text-link-visited/80'],
        secondary: ['text-muted-foreground hover:text-foreground/90 active:text-muted-foreground/80 visited:text-muted-foreground'],
      },
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 pointer-events-none'],
        false: [],
      },
    },
    compoundVariants: [
      { variant: 'primary', disabled: true, class: '!text-foreground' },
    ],
    defaultVariants: {
      variant: 'primary',
      disabled: false,
    },
  });

  export type LinkVariants = VariantProps<typeof linkVariants>;

  export interface LinkProps extends LinkVariants, HTMLAnchorAttributes {
    /** クラス */
    class?: ClassValue;
    children?: Snippet<[]>;
    /** 内部で使用するため指定できません */
    'data-rabee-ui'?: never;
  }
</script>

<script lang="ts">
  import ExternalLink from '@lucide/svelte/icons/external-link';

  let { variant, class: className, children, disabled, ...anchorAttributes }: LinkProps = $props();

  let isExternal = $derived(anchorAttributes.target === '_blank');
  let resolvedRel = $derived(isExternal ? [anchorAttributes.rel, 'noopener noreferrer'].filter(Boolean).join(' ') : anchorAttributes.rel);
  let linkVariantClass = $derived(linkVariants({ class: className, variant, disabled }));
</script>

<a class={linkVariantClass} {...anchorAttributes} rel={resolvedRel} aria-disabled={disabled || undefined} tabindex={disabled ? -1 : undefined} data-rabee-ui="link">
  {@render children?.()}
  {#if isExternal}
    <ExternalLink class="size-4 shrink-0" aria-hidden="true" />
  {/if}
</a>

      
