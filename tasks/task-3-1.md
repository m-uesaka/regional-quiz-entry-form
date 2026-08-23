[← tasks.md](../tasks.md) / Phase 3: エントリーフォーム機能(参加者向け)

### Task 3-1: フォーム動的レンダリング ✅

#### 実装・更新内容

* 大会の `form_field_defs`(checkbox/radio/textarea)を取得し、共通コンポーネントで動的にフォームを描画する仕組みを実装する。
* `apps/frontend/src/lib/components/DynamicFormField.svelte` を用意し、`type` によって描画を切り替える。

#### コードスニペット

`apps/frontend/src/lib/components/DynamicFormField.svelte`

```svelte
<script lang="ts">
  import type { FormFieldDefYaml } from '@regional-quiz/shared';

  interface Props {
    field: FormFieldDefYaml;
    value: string | string[];
    onChange: (value: string | string[]) => void;
  }

  let { field, value, onChange }: Props = $props();
</script>

{#if field.type === 'textarea'}
  <textarea required={field.required} value={value as string}
    oninput={(e) => onChange((e.target as HTMLTextAreaElement).value)}></textarea>
{:else if field.type === 'radio'}
  {#each field.options ?? [] as option (option)}
    <label>
      <input type="radio" name={field.key} value={option}
        checked={value === option}
        onchange={() => onChange(option)} />
      {option}
    </label>
  {/each}
{:else if field.type === 'checkbox'}
  {#each field.options ?? [] as option (option)}
    <label>
      <input type="checkbox" value={option}
        checked={(value as string[]).includes(option)}
        onchange={(e) => {
          const checked = (e.target as HTMLInputElement).checked;
          const current = value as string[];
          onChange(checked ? [...current, option] : current.filter((v) => v !== option));
        }} />
      {option}
    </label>
  {/each}
{/if}
```

#### テスト

* Component test: `radio` フィールドで選択肢クリック時に `onChange` が選択値で呼ばれることを assert する
* Component test: `checkbox` フィールドで複数選択・解除時に配列が正しく更新されることを assert する

#### 依存タスク

* Task 1-3, Task 0-4
