<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {
    toFormFieldDefYaml,
    type MypageEntryDetail,
  } from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import type {EntryEditFormValues} from '$lib/types/entry-form';

  interface Props {
    entry: MypageEntryDetail;
    /** What the last rejected submission carried back, if there was one. */
    values?: EntryEditFormValues;
  }

  const {entry, values}: Props = $props();

  // The stored definitions carry API-shaped keys (`fieldKey` / `fieldType`);
  // `DynamicFormField` renders the shape the form was authored in.
  const fields = $derived(entry.formFieldDefs.map(toFormFieldDefYaml));

  // A rejected submission comes back with what was typed, so the form starts
  // out showing that rather than resetting to the stored entry.
  //
  // Read once and owned by the controls from then on — the submitted body is
  // built from their `name` attributes, so nothing below needs to be pushed
  // back into them. See "Form controls are bound, not rendered from an
  // expression" in `apps/frontend/README.md`.
  //
  // Re-seeding on a move to another entry's form is the caller's job:
  // SvelteKit keeps a page component across a navigation that changes only
  // the route parameters, so the page wraps this component in
  // `{#key data.entry.id}` to have it built afresh instead.
  const initial = untrack(() => values ?? entry);

  let name = $state(initial.name);
  let furigana = $state(initial.furigana);
  let displayName = $state(initial.displayName);
  let freeText = $state(initial.freeText ?? '');
  let customFieldValues = $state(initialCustomFieldValues());

  /**
   * The answer every custom field starts out with, keyed by field key.
   * Every key the form renders is seeded, unanswered ones included, so that
   * `DynamicFormField` always has a value of the right shape to bind to.
   */
  function initialCustomFieldValues(): Record<string, string | string[]> {
    const answered = initial.customFieldValues;
    return Object.fromEntries(
      entry.formFieldDefs.map(fieldDef => [
        fieldDef.fieldKey,
        answered[fieldDef.fieldKey] ??
          (fieldDef.fieldType === 'checkbox' ? [] : ''),
      ]),
    );
  }
</script>

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
    <DynamicFormField {field} bind:value={customFieldValues[field.key]} />
  {/each}

  <button type="submit">保存する</button>
</form>
