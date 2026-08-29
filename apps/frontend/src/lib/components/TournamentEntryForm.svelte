<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {
    toFormFieldDefYaml,
    type FormFieldDef,
    type Regulation,
  } from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import {customFieldName} from '$lib/custom-field-name';
  import RegulationSelector from '$lib/components/RegulationSelector.svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import type {EntryFieldErrors, EntryFormValues} from '$lib/types/entry-form';

  interface Props {
    formFieldDefs: FormFieldDef[];
    regulations: Regulation[];
    /** What the last rejected submission carried back, if there was one. */
    values?: EntryFormValues;
    fieldErrors?: EntryFieldErrors;
  }

  const {formFieldDefs, regulations, values, fieldErrors}: Props = $props();

  // The stored definitions carry API-shaped keys (`fieldKey` / `fieldType`);
  // `DynamicFormField` renders the shape the form was authored in.
  const fields = $derived(formFieldDefs.map(toFormFieldDefYaml));

  // A rejected submission comes back with what was typed (minus the
  // passwords, which the action deliberately doesn't echo), so the form
  // starts out showing that rather than emptying itself.
  //
  // Read once and owned by the controls from then on — the submitted body is
  // built from their `name` attributes, so nothing below needs to be pushed
  // back into them. See "Form controls are bound, not rendered from an
  // expression" in `apps/frontend/README.md`.
  //
  // Re-seeding on a move to another tournament's form is the caller's job:
  // SvelteKit keeps a page component across a navigation that changes only
  // the route parameters, so the page wraps this component in
  // `{#key data.tournament.id}` to have it built afresh instead.
  const initial = untrack(() => values);

  let name = $state(initial?.name ?? '');
  let furigana = $state(initial?.furigana ?? '');
  let displayName = $state(initial?.displayName ?? '');
  let email = $state(initial?.email ?? '');
  let freeText = $state(initial?.freeText ?? '');
  let regulationIds = $state<string[]>(initial?.regulationIds ?? []);
  let customFieldValues = $state(initialCustomFieldValues());
  let turnstile = $state<ReturnType<typeof Turnstile>>();

  function fieldError(field: string): string | undefined {
    return fieldErrors?.[field]?.[0];
  }

  /**
   * The answer every custom field starts out with, keyed by field key.
   * Every key the form renders is seeded, unanswered ones included, so that
   * `DynamicFormField` always has a value of the right shape to bind to.
   */
  function initialCustomFieldValues(): Record<string, string | string[]> {
    const answered = initial?.customFieldValues ?? {};
    return Object.fromEntries(
      formFieldDefs.map(fieldDef => [
        fieldDef.fieldKey,
        answered[fieldDef.fieldKey] ??
          (fieldDef.fieldType === 'checkbox' ? [] : ''),
      ]),
    );
  }
</script>

<!-- The `enhance` callback is only here to hand the challenge back: a
     rejected submission is reported with `fail()`, which re-renders this
     form in place with the token it already spent still in it, and the
     retry the message invites would then fail the challenge rather than
     whatever it was actually refused for. See `Turnstile.svelte`. -->
<form
  method="POST"
  use:enhance={() => {
    return async ({update}) => {
      await update();
      turnstile?.reset();
    };
  }}
>
  <div class="form-field">
    <label for="name">氏名</label>
    <input id="name" name="name" bind:value={name} required />
    {#if fieldError('name')}<p class="field-error">{fieldError('name')}</p>{/if}
  </div>

  <div class="form-field">
    <label for="furigana">ふりがな</label>
    <input id="furigana" name="furigana" bind:value={furigana} required />
    {#if fieldError('furigana')}
      <p class="field-error">{fieldError('furigana')}</p>
    {/if}
  </div>

  <div class="form-field">
    <label for="displayName">掲載名</label>
    <input
      id="displayName"
      name="displayName"
      bind:value={displayName}
      required
    />
    {#if fieldError('displayName')}
      <p class="field-error">{fieldError('displayName')}</p>
    {/if}
  </div>

  <div class="form-field">
    <label for="email">メールアドレス</label>
    <input id="email" name="email" type="email" bind:value={email} required />
    {#if fieldError('email')}
      <p class="field-error">{fieldError('email')}</p>
    {/if}
  </div>

  <!-- An email address that has already entered another tournament keeps
       its existing password; entering it again is how the API recognizes
       the same participant. -->
  <div class="form-field">
    <label for="password">パスワード</label>
    <input
      id="password"
      name="password"
      type="password"
      minlength="8"
      autocomplete="new-password"
      required
    />
    {#if fieldError('password')}
      <p class="field-error">{fieldError('password')}</p>
    {/if}
  </div>

  <div class="form-field">
    <label for="passwordConfirm">パスワード(確認)</label>
    <input
      id="passwordConfirm"
      name="passwordConfirm"
      type="password"
      minlength="8"
      autocomplete="new-password"
      required
    />
    {#if fieldError('passwordConfirm')}
      <p class="field-error">{fieldError('passwordConfirm')}</p>
    {/if}
  </div>

  <RegulationSelector {regulations} bind:value={regulationIds} />
  {#if fieldError('regulationIds')}
    <p class="field-error">{fieldError('regulationIds')}</p>
  {/if}

  {#each fields as field (field.key)}
    <!-- Keyed by the control's namespaced name, the same key the action
         files a custom field's message under. -->
    <DynamicFormField
      {field}
      bind:value={customFieldValues[field.key]}
      error={fieldError(customFieldName(field.key))}
    />
  {/each}

  <div class="form-field">
    <label for="freeText">自由記述</label>
    <textarea id="freeText" name="freeText" bind:value={freeText}></textarea>
  </div>

  <!-- The widget drops a hidden `cf-turnstile-response` control into this
       form, which the page's action forwards to the API. Entry registration
       mails a confirmation to whatever address it is given, so it is one of
       the two forms behind a challenge as well as a rate limit (#116). -->
  <Turnstile bind:this={turnstile} />

  <button type="submit">エントリーする</button>
</form>
