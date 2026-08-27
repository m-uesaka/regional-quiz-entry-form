<script lang="ts">
  import type {FormFieldDefYaml} from '@regional-quiz/shared';
  import {customFieldName} from '$lib/custom-field-name';

  interface Props {
    field: FormFieldDefYaml;
    /**
     * The field's answer: the chosen option for a `radio` field, the list of
     * chosen ones for a `checkbox` field, the text for a `textarea` field.
     * Bound, so answering the field writes it back to the caller — see "Form
     * controls are bound, not rendered from an expression" in
     * `apps/frontend/README.md`.
     */
    value: string | string[];
  }

  let {field, value = $bindable()}: Props = $props();

  // Namespaced so a field key that happens to match one of the form's own
  // inputs (`name`, `email`, `password`, ...) can't submit under the same
  // key as it. See `$lib/custom-field-name`.
  const controlName = $derived(customFieldName(field.key));

  // A `checkbox` field with no `options` is a plain boolean toggle (e.g.
  // "I agree to the rules"). To keep the component's value type consistent
  // (`string | string[]`) across all field types, "checked" is represented
  // as an array containing the field's own key, and "unchecked" as an
  // empty array — which is what a one-checkbox group binding produces once
  // the box carries the field key as its value.
  const booleanCheckboxValue = $derived(field.key);

  // A required multi-option checkbox group has no native HTML equivalent of
  // "at least one checked". Instead, mark every checkbox in the group as
  // `required` only while none of them is checked; once one is checked, the
  // browser's constraint validation is already satisfied for the group, so
  // `required` is dropped from all of them.
  const hasCheckboxSelection = $derived(
    Array.isArray(value) && value.length > 0,
  );
</script>

{#if field.type === 'textarea'}
  <div class="form-field">
    <label for={controlName}>
      {field.label}
      {#if field.required}<span aria-hidden="true">*</span>{/if}
    </label>
    <textarea
      id={controlName}
      name={controlName}
      required={field.required}
      bind:value
    ></textarea>
  </div>
{:else if field.type === 'radio'}
  <fieldset class="form-field">
    <legend>
      {field.label}
      {#if field.required}<span aria-hidden="true">*</span>{/if}
    </legend>
    {#each field.options as option (option)}
      <label>
        <input
          type="radio"
          name={controlName}
          value={option}
          required={field.required}
          bind:group={value}
        />
        {option}
      </label>
    {/each}
  </fieldset>
{:else if field.type === 'checkbox'}
  {#if field.options && field.options.length > 0}
    <fieldset class="form-field">
      <legend>
        {field.label}
        {#if field.required}<span aria-hidden="true">*</span>{/if}
      </legend>
      {#each field.options as option (option)}
        <label>
          <input
            type="checkbox"
            name={controlName}
            value={option}
            required={field.required && !hasCheckboxSelection}
            bind:group={value}
          />
          {option}
        </label>
      {/each}
    </fieldset>
  {:else}
    <div class="form-field">
      <label>
        <input
          type="checkbox"
          name={controlName}
          value={booleanCheckboxValue}
          required={field.required}
          bind:group={value}
        />
        {field.label}
      </label>
    </div>
  {/if}
{/if}
