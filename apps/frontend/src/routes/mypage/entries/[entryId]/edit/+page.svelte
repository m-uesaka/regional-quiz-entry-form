<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {toFormFieldDefYaml} from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import {customFieldName} from '$lib/custom-field-name';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();

  // The stored definitions carry API-shaped keys (`fieldKey` / `fieldType`);
  // `DynamicFormField` renders the shape the form was authored in.
  const fields = $derived(data.entry.formFieldDefs.map(toFormFieldDefYaml));

  // A rejected submission comes back with what was typed, so the form starts
  // out showing that rather than resetting to the stored entry.
  //
  // Read once and owned by the controls from then on — the submitted body is
  // built from their `name` attributes, so nothing below needs to be pushed
  // back into them. See "Form controls are bound, not rendered from an
  // expression" in `apps/frontend/README.md`.
  //
  // SvelteKit keeps this component across a navigation that changes only the
  // route parameters, and nothing re-seeds these on such a move — so a link
  // from one entry's edit form straight to another's would carry the first
  // entry's answers over. Only `/mypage` links here today, and leaving for it
  // destroys the component; a link that skips it needs this state moved into
  // a child component wrapped in `{#key data.entry.id}`.
  const initial = untrack(() => form?.values ?? data.entry);

  let name = $state(initial.name);
  let furigana = $state(initial.furigana);
  let displayName = $state(initial.displayName);
  let freeText = $state(initial.freeText ?? '');
  let customFieldValues = $state(initialCustomFieldValues());

  function fieldError(field: string): string | undefined {
    return form?.fieldErrors?.[field]?.[0];
  }

  /**
   * The answer every custom field starts out with, keyed by field key.
   * Every key the form renders is seeded, unanswered ones included, so that
   * `DynamicFormField` always has a value of the right shape to bind to.
   */
  function initialCustomFieldValues(): Record<string, string | string[]> {
    const answered = initial.customFieldValues;
    return Object.fromEntries(
      data.entry.formFieldDefs.map(fieldDef => [
        fieldDef.fieldKey,
        answered[fieldDef.fieldKey] ??
          (fieldDef.fieldType === 'checkbox' ? [] : ''),
      ]),
    );
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
    <input id="name" name="name" bind:value={name} required />
  </div>

  <div class="form-field">
    <label for="furigana">ふりがな</label>
    <input id="furigana" name="furigana" bind:value={furigana} required />
  </div>

  <div class="form-field">
    <label for="displayName">掲載名</label>
    <input
      id="displayName"
      name="displayName"
      bind:value={displayName}
      required
    />
  </div>

  <div class="form-field">
    <label for="freeText">自由記述</label>
    <textarea id="freeText" name="freeText" bind:value={freeText}></textarea>
  </div>

  {#each fields as field (field.key)}
    <!-- Keyed by the control's namespaced name, the same key the action
         files a custom field's message under. -->
    <DynamicFormField
      {field}
      bind:value={customFieldValues[field.key]}
      error={fieldError(customFieldName(field.key))}
    />
  {/each}

  <button type="submit">保存する</button>
</form>

<a href="/mypage">マイページへ戻る</a>
