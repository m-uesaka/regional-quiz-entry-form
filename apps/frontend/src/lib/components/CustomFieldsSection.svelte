<!--
@component
A tournament's custom fields, with the message for the answers as a whole
under them. Renders no wrapper of its own, so the fields stay direct children
of the form's layout.

`values` is bound, and seeded by the form that owns it with
`initialCustomFieldValues()`. This component holds no state of its own, so
nothing here can reset what is being typed when a rejected submission
re-renders the form. See "A seeded form lives in a child component" in
`apps/frontend/README.md`.
-->
<script lang="ts">
  import {
    toFormFieldDefYaml,
    type CustomFieldValues,
    type FormFieldDef,
  } from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import FieldError from '$lib/components/form/FieldError.svelte';
  import {customFieldName} from '$lib/custom-field-name';
  import {firstFieldError} from '$lib/entry-form';
  import type {EntryFieldErrors} from '$lib/types/entry-form';

  interface Props {
    formFieldDefs: FormFieldDef[];
    values: CustomFieldValues;
    fieldErrors?: EntryFieldErrors;
  }

  let {formFieldDefs, values = $bindable(), fieldErrors}: Props = $props();

  // The stored definitions carry API-shaped keys (`fieldKey` / `fieldType`);
  // `DynamicFormField` renders the shape the form was authored in.
  const fields = $derived(formFieldDefs.map(toFormFieldDefYaml));
</script>

{#each fields as field (field.key)}
  <!-- Keyed by the control's namespaced name, the same key the action
       files a custom field's message under. -->
  <DynamicFormField
    {field}
    bind:value={values[field.key]}
    error={firstFieldError(fieldErrors, customFieldName(field.key))}
  />
{/each}
<!-- Every answer within its own bound can still add up past the combined
     one; that has no single control to point at. -->
<FieldError error={firstFieldError(fieldErrors, 'customFieldValues')} />
