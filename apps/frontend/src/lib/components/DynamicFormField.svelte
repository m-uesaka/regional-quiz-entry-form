<script lang="ts">
  import type {FormFieldDefYaml} from '@regional-quiz/shared';

  interface Props {
    field: FormFieldDefYaml;
    value: string | string[];
    onChange: (value: string | string[]) => void;
  }

  const {field, value, onChange}: Props = $props();

  // A `checkbox` field with no `options` is a plain boolean toggle (e.g.
  // "I agree to the rules"). To keep the component's value type consistent
  // (`string | string[]`) across all field types, "checked" is represented
  // as an array containing the field's own key, and "unchecked" as an
  // empty array.
  const booleanCheckboxValue = $derived(field.key);

  function isChecked(option: string): boolean {
    return Array.isArray(value) && value.includes(option);
  }

  function toggleOption(option: string, checked: boolean): void {
    const current = Array.isArray(value) ? value : [];
    onChange(
      checked
        ? [...current, option]
        : current.filter(selected => selected !== option),
    );
  }

  function handleTextareaInput(event: Event): void {
    onChange((event.currentTarget as HTMLTextAreaElement).value);
  }

  function handleCheckboxChange(option: string, event: Event): void {
    toggleOption(option, (event.currentTarget as HTMLInputElement).checked);
  }
</script>

{#if field.type === 'textarea'}
  <div class="form-field">
    <label for={field.key}>
      {field.label}
      {#if field.required}<span aria-hidden="true">*</span>{/if}
    </label>
    <textarea
      id={field.key}
      name={field.key}
      required={field.required}
      value={typeof value === 'string' ? value : ''}
      oninput={handleTextareaInput}
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
          name={field.key}
          value={option}
          required={field.required}
          checked={value === option}
          onchange={() => onChange(option)}
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
            name={field.key}
            value={option}
            checked={isChecked(option)}
            onchange={event => handleCheckboxChange(option, event)}
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
          name={field.key}
          required={field.required}
          checked={isChecked(booleanCheckboxValue)}
          onchange={event =>
            handleCheckboxChange(booleanCheckboxValue, event)}
        />
        {field.label}
      </label>
    </div>
  {/if}
{/if}
