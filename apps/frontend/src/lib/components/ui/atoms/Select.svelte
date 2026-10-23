<!--
@component
## 概要
- selectタグのように、選択肢の中から値を1つ選べる汎用的なセレクトボックスコンポーネントです

## 機能
- selectタグのように、選択肢の中から1つを選択できます
- プレースホルダーの表示、選択解除ボタン、フォーカスやキーボード操作への対応
- 画面の表示領域に応じて、ドロップダウンの表示方向（上/下）を自動調整
- エラー状態や操作状態を制御するためのPropsが追加されています（詳細はPropsセクションを参照）

## Props
- id: コントロールとリストボックスの関連付けに使用するID
- value: 現在選択中の値（双方向バインディング可）
- size: サイズを指定します
- options: 選択肢のリスト（SelectOptionItem型の配列）
- placeholder: 未選択時に表示するテキスト
- isError: true の場合エラー時のスタイルを適用します
- clearable: デフォルト値は false。true に設定すると、選択された値をクリアできるようになります
- disabled: 指定するとグレーアウトされ、クリック不可になります

## Usage
```svelte
<Select options={options} placeholder="選択してください" bind:value />
```
-->

<script module lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import { cva, type VariantProps } from 'class-variance-authority';

  const MAX_VISIBLE_OPTIONS = 5;

  export const selectVariants = cva('flex items-center justify-between w-full py-0.5 pr-3 pl-1 border rounded-md text-sm outline-offset-2 outline-ring transition hover:bg-accent focus-visible:outline-2 focus:transition-none', {
    variants: {
      /** セレクトのサイズ */
      size: {
        small: ['min-h-9'],
        medium: ['min-h-10'],
        large: ['min-h-11'],
      },
      /** 操作できるかどうか */
      disabled: {
        true: ['opacity-50 pointer-events-none'],
        false: ['cursor-pointer'],
      },
      /** エラーかどうか */
      isError: {
        true: ['border-destructive'],
        false: ['border-input'],
      },
    },
    defaultVariants: {
      size: 'medium',
      disabled: false,
    },
  });

  export const selectBoxVariants = cva('absolute top-[calc(100%+2px)] z-50 w-full p-1 bg-surface border border-border rounded-md shadow-xs overflow-hidden outline-offset-2 outline-ring origin-top focus-visible:outline-2');

  export type SelectVariants = VariantProps<typeof selectVariants>;

  export interface SelectOptionItem {
    /** 選択肢のラベル */
    label: string;
    /** 選択肢の値 */
    value: string;
  }

  export interface SelectProps extends SelectVariants {
    /** リストボックスとコントロールの関連付けに使用されるDOM ID */
    id?: string;
    /** 現在選択されている値 */
    value?: string;
    /** 未選択時に表示するテキスト */
    placeholder?: string;
    /** クラス */
    class?: ClassValue;
    /** 現在選択されている値をクリアできるかどうか */
    clearable?: boolean;
    /** オプションのリスト */
    options: SelectOptionItem[];
    /** 選択されたときのコールバック関数 */
    onChange?: (value: string) => void;
    /** option 1件ぶんをカスタム描画したいときの snippet */
    optionContent?: Snippet<[any]>;
  }
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import X from '@lucide/svelte/icons/x';
  import { type Snippet, tick } from 'svelte';
  import { scale } from 'svelte/transition';

  let {
    id,
    value = $bindable(''),
    placeholder = '',
    class: className,
    size,
    isError = false,
    disabled = false,
    clearable = false,
    options = [],
    onChange,
    optionContent,
  }: SelectProps = $props();

  let selectBoxElement: HTMLDivElement;
  let selectBoxListContainer = $state<HTMLDivElement>();
  let selectBoxListElement = $state<HTMLDivElement>();

  let isOpen = $state(false);
  // スクロール位置が一番上にあるかどうか(リストを開いた時は一番上になるので初期値 true)
  let isScrolledToTop = $state(true);
  // スクロール位置が一番下にあるかどうか
  let isScrolledToBottom = $state(false);
  let showScrollButtons = $derived.by(() => {
    return options.length > MAX_VISIBLE_OPTIONS;
  });
  let scrollInterval: ReturnType<typeof setInterval> | null = null;

  let selectedOption = $derived.by(() => {
    return options.find((option) => option.value === value) ?? null;
  });

  let selectVariantClass = $derived(selectVariants({ size, isError, disabled }));

  function handleSelect(event: Event) {
    event.preventDefault();
    isOpen = !isOpen;
    if (isOpen) {
      tick().then(() => {
        // 選択済みだった場合はそれをフォーカスしておく
        if (selectBoxListElement && value) {
          const selected = Array.from(selectBoxListElement.children).find(
            (el) => el.getAttribute('data-value') === value,
          ) as HTMLElement;
          selected?.focus();
        }
      });
    }
  }

  function handleKeydownSelect(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(event);
    }
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        isOpen = true;
      }
      else {
        const first_item = selectBoxListContainer?.querySelector('[tabindex="0"]') as HTMLElement;
        first_item?.focus();
      }
    }
  }

  function listboxClose(event: Event) {
    if (selectBoxElement && selectBoxElement.contains(event.target as Node)) return;
    if (selectBoxListContainer && selectBoxListContainer.contains(event.target as Node)) return;
    isOpen = false;
  }

  function handleClear(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    value = '';
  }

  function startScroll(direction: 'up' | 'down') {
    if (scrollInterval || !selectBoxListElement) return;
    scrollInterval = setInterval(() => {
      selectBoxListElement?.scrollBy({
        top: direction === 'up' ? -20 : 20,
        behavior: 'smooth',
      });
    }, 50);
  }

  function stopScroll() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  function handleScrollSelectBox() {
    if (!selectBoxListElement) return;
    isScrolledToTop = selectBoxListElement.scrollTop === 0;
    isScrolledToBottom = Math.abs(selectBoxListElement.scrollHeight - selectBoxListElement.scrollTop - selectBoxListElement.clientHeight) < 1;

    // 要素が消えてしまうと setinterval を clear できないので考慮
    if (isScrolledToBottom || isScrolledToTop) {
      stopScroll();
    }
  }

  function listItemSelectClose() {
    isOpen = false;
  }

  function listItemSelectKeyDownClose(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      isOpen = false;
    }
  }

  function handleSelectValue(v: string) {
    value = v;
    isOpen = false;

    onChange?.(v);

    selectBoxElement?.focus();
  }

  function handleKeydown(event: KeyboardEvent, optionValue: string) {
    const target = event.currentTarget as HTMLElement;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelectValue(optionValue);
    }
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = target.nextElementSibling as HTMLElement;
      next?.focus();
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = target.previousElementSibling as HTMLElement;
      prev?.focus();
    }
  }

  function handleMouseenterFocus(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;

    target?.focus();
  }

  function handleMouseleaveBlur(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;

    target?.blur();
  }
</script>

<svelte:window onclick={listboxClose} />

<div class={['relative', className]} class:cursor-not-allowed={disabled} data-rabee-ui="select">
  <div class={selectVariantClass} onclick={(e) => handleSelect(e)} role="combobox" tabindex={disabled ? -1 : 0} onkeydown={(e) => handleKeydownSelect(e)} aria-controls={id} aria-expanded={isOpen} bind:this={selectBoxElement}>
    {#if optionContent}
      {@render optionContent({ option: selectedOption, value, index: -1 })}
    {:else}
      <div class="px-2">
        {#if selectedOption}
          <span class="text-foreground">{selectedOption.label}</span>
        {:else}
          <span class="text-muted-foreground">{placeholder}</span>
        {/if}
      </div>
    {/if}

    {#if value && clearable}
      <button class="px-0.5 py-1.5 select-none cursor-pointer" onclick={(e) => handleClear(e)} tabindex="-1">
        <X class="size-4 text-subtle-foreground transition-colors hover:text-accent-foreground" />
      </button>
    {:else}
      <div class="px-0.5 py-1.5">
        <ChevronDown class="size-4 text-muted-foreground" />
      </div>
    {/if}
  </div>

  {#if isOpen}
    <div class={[selectBoxVariants(), showScrollButtons && 'py-6']} role="listbox" bind:this={selectBoxListContainer} transition:scale={{ start: 0.98, opacity: 0, duration: 100 }}>
      {#if showScrollButtons}
        <!-- 上スクロール -->
        {#if !isScrolledToTop}
          <button class="absolute top-0 left-0 z-50 flex items-center justify-center w-full h-6 py-1 bg-surface rounded-sm text-sm" type="button" onmouseenter={() => startScroll('up')} onmouseleave={stopScroll}>
            <ChevronUp class="object-contain text-muted-foreground" size="1rem" />
          </button>
        {/if}

        <!-- 下スクロール -->
        {#if !isScrolledToBottom}
          <button class="absolute bottom-0 left-0 z-50 flex items-center justify-center w-full h-6 py-1 bg-surface text-sm" type="button" onmouseenter={() => startScroll('down')} onmouseleave={stopScroll}>
            <ChevronDown class="object-contain text-muted-foreground" size="1rem" />
          </button>
        {/if}
      {/if}
      <div class="max-h-40 overflow-y-scroll hidden-scrollbar" onclick={listItemSelectClose} onkeydown={listItemSelectKeyDownClose} onscroll={handleScrollSelectBox} role="presentation" bind:this={selectBoxListElement}>
        {#each options as option, index}
          <div class="relative flex items-center h-full rounded-xs text-sm/normal select-none focus:bg-accent focus:outline-none" onclick={() => handleSelectValue(option.value)} onkeydown={(e) => handleKeydown(e, option.value)} onmouseenter={(e) => handleMouseenterFocus(e)} onmouseleave={(e) => handleMouseleaveBlur(e)} tabindex="0" role="option" aria-selected={option.value === value} data-value={option.value}>
            {#if optionContent}
              {@render optionContent({ option, value, index })}
            {:else}
              <div class="px-4 py-1.5">
                {#if option.value === value}
                  <div class="absolute inset-y-0 left-4 flex items-center">
                    <Check class="size-4 text-foreground" />
                  </div>
                {/if}
                <div class="pl-6 text-foreground">
                  {option.label}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .hidden-scrollbar {
    -ms-overflow-style: none;
    /* IE, Edge 対応 */
    scrollbar-width: none;
    /* Firefox 対応 */
  }

  .hidden-scrollbar::-webkit-scrollbar {
    /* Chrome, Safari 対応 */
    display: none;
  }
</style>

      
