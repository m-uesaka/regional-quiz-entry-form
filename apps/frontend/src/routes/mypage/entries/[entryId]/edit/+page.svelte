<script lang="ts">
  import {enhance} from '$app/forms';
  import {toFormFieldDefYaml} from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();

  // The stored definitions carry API-shaped keys (`fieldKey` / `fieldType`);
  // `DynamicFormField` renders the shape the form was authored in.
  const fields = $derived(data.entry.formFieldDefs.map(toFormFieldDefYaml));

  // A rejected submission comes back with what was typed, so the form
  // re-renders that rather than resetting to the stored entry.
  const values = $derived(form?.values ?? data.entry);

  // The submitted body is rebuilt server-side from the named inputs
  // `DynamicFormField` renders, so this state only drives what the component
  // shows as currently selected. Seeded once (through a function, so it
  // isn't read as a reactive dependency) and owned by the form from then on.
  function initialCustomFieldValues(): Record<string, string | string[]> {
    return {...(form?.values?.customFieldValues ?? data.entry.customFieldValues)};
  }

  let customFieldValues = $state(initialCustomFieldValues());

  function valueFor(key: string): string | string[] {
    return customFieldValues[key] ?? '';
  }

  function setValue(key: string, value: string | string[]): void {
    customFieldValues = {...customFieldValues, [key]: value};
  }
</script>

<h1>{data.entry.tournament.name} のエントリー内容を編集</h1>

<p>レギュレーション: {data.entry.regulationLabel}</p>

{#if form?.error}
  <p role="alert">{form.error}</p>
{/if}

<form method="POST" use:enhance>
  <div class="form-field">
    <label for="name">氏名</label>
    <input id="name" name="name" value={values.name} required />
  </div>

  <div class="form-field">
    <label for="furigana">ふりがな</label>
    <input id="furigana" name="furigana" value={values.furigana} required />
  </div>

  <div class="form-field">
    <label for="displayName">掲載名</label>
    <input
      id="displayName"
      name="displayName"
      value={values.displayName}
      required
    />
  </div>

  <div class="form-field">
    <label for="freeText">自由記述</label>
    <textarea id="freeText" name="freeText" value={values.freeText ?? ''}
    ></textarea>
  </div>

  {#each fields as field (field.key)}
    <DynamicFormField
      {field}
      value={valueFor(field.key)}
      onChange={value => setValue(field.key, value)}
    />
  {/each}

  <button type="submit">保存する</button>
</form>

<a href="/mypage">マイページへ戻る</a>
