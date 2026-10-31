<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {
    ENTRY_FREE_TEXT_MAX_LENGTH,
    ENTRY_NAME_MAX_LENGTH,
    toFormFieldDefYaml,
    type MypageEntryDetail,
  } from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import FieldError from '$lib/components/form/FieldError.svelte';
  import TextField from '$lib/components/form/TextField.svelte';
  import {customFieldName} from '$lib/custom-field-name';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import type {
    EntryEditFormValues,
    EntryFieldErrors,
  } from '$lib/types/entry-form';

  interface Props {
    entry: MypageEntryDetail;
    /** What the last rejected submission carried back, if there was one. */
    values?: EntryEditFormValues;
    fieldErrors?: EntryFieldErrors;
  }

  const {entry, values, fieldErrors}: Props = $props();

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

  function fieldError(field: string): string | undefined {
    return fieldErrors?.[field]?.[0];
  }

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

<form method="POST" class="flex flex-col gap-4" use:enhance>
  <TextField
    id="name"
    name="name"
    label="氏名"
    bind:value={name}
    maxlength={ENTRY_NAME_MAX_LENGTH}
    error={fieldError('name')}
    required
  />

  <TextField
    id="furigana"
    name="furigana"
    label="ふりがな"
    bind:value={furigana}
    maxlength={ENTRY_NAME_MAX_LENGTH}
    error={fieldError('furigana')}
    required
  />

  <TextField
    id="displayName"
    name="displayName"
    label="エントリーリスト掲載名"
    bind:value={displayName}
    maxlength={ENTRY_NAME_MAX_LENGTH}
    error={fieldError('displayName')}
    required
  />

  <TextField
    id="freeText"
    name="freeText"
    label="自由記述"
    multiline
    bind:value={freeText}
    maxlength={ENTRY_FREE_TEXT_MAX_LENGTH}
    error={fieldError('freeText')}
  />

  {#each fields as field (field.key)}
    <!-- Keyed by the control's namespaced name, the same key the action
         files a custom field's message under. -->
    <DynamicFormField
      {field}
      bind:value={customFieldValues[field.key]}
      error={fieldError(customFieldName(field.key))}
    />
  {/each}
  <!-- Every answer within its own bound can still add up past the combined
       one; that has no single control to point at. -->
  <FieldError error={fieldError('customFieldValues')} />

  <div class="flex flex-wrap gap-2 pt-2">
    <Button type="submit" variant="primary" tone="solid">保存する</Button>
  </div>
</form>
