<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import type {MypageEntryDetail} from '@regional-quiz/shared';
  import CustomFieldsSection from '$lib/components/CustomFieldsSection.svelte';
  import EntryProfileFields from '$lib/components/EntryProfileFields.svelte';
  import {initialCustomFieldValues} from '$lib/entry-form';
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
  let customFieldValues = $state(
    untrack(() =>
      initialCustomFieldValues(entry.formFieldDefs, initial.customFieldValues),
    ),
  );
</script>

<form method="POST" class="flex flex-col gap-4" use:enhance>
  <EntryProfileFields
    bind:name
    bind:furigana
    bind:displayName
    bind:freeText
    {fieldErrors}
  />

  <CustomFieldsSection
    formFieldDefs={entry.formFieldDefs}
    bind:values={customFieldValues}
    {fieldErrors}
  />

  <div class="flex flex-wrap gap-2 pt-2">
    <Button type="submit" variant="primary" tone="solid">保存する</Button>
  </div>
</form>
