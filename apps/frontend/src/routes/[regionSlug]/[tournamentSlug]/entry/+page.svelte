<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {toFormFieldDefYaml} from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import RegulationSelector from '$lib/components/RegulationSelector.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  // The stored definitions carry API-shaped keys (`fieldKey` / `fieldType`);
  // `DynamicFormField` renders the shape the form was authored in.
  const fields = $derived(data.formFieldDefs.map(toFormFieldDefYaml));

  // A rejected submission comes back with what was typed (minus the
  // passwords, which the action deliberately doesn't echo), so the form
  // starts out showing that rather than emptying itself.
  //
  // Read once and owned by the controls from then on — the submitted body is
  // built from their `name` attributes, so nothing below needs to be pushed
  // back into them. See "Form controls are bound, not rendered from an
  // expression" in `apps/frontend/README.md`.
  //
  // SvelteKit keeps this component across a navigation that changes only the
  // route parameters, and nothing re-seeds these on such a move — so a link
  // from one tournament's entry form straight to another's would carry the
  // first tournament's answers over. Nothing links here today (participants
  // arrive at a URL they were given, which is a fresh page load); a link that
  // does needs this state moved into a child component wrapped in
  // `{#key data.tournament.id}`.
  const initial = untrack(() => form?.values);

  let name = $state(initial?.name ?? '');
  let furigana = $state(initial?.furigana ?? '');
  let displayName = $state(initial?.displayName ?? '');
  let email = $state(initial?.email ?? '');
  let freeText = $state(initial?.freeText ?? '');
  let regulationId = $state<string | null>(initial?.regulationId ?? null);
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
    const answered = initial?.customFieldValues ?? {};
    return Object.fromEntries(
      data.formFieldDefs.map(fieldDef => [
        fieldDef.fieldKey,
        answered[fieldDef.fieldKey] ??
          (fieldDef.fieldType === 'checkbox' ? [] : ''),
      ]),
    );
  }
</script>

<h1>{data.tournament.name} へのエントリー</h1>

{#if form?.submitted}
  <p role="status">
    エントリーを受け付けました。{form.email} 宛に確認メールを送信したので、
    メール内のリンクを開いてエントリーを確定してください。
  </p>
{:else}
  {#if form?.error}
    <p role="alert">{form.error}</p>
  {/if}

  <form method="POST" use:enhance>
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

    <RegulationSelector
      regulations={data.regulations}
      bind:value={regulationId}
    />
    {#if fieldError('regulationId')}
      <p class="field-error">{fieldError('regulationId')}</p>
    {/if}

    {#each fields as field (field.key)}
      <DynamicFormField {field} bind:value={customFieldValues[field.key]} />
    {/each}

    <div class="form-field">
      <label for="freeText">自由記述</label>
      <textarea id="freeText" name="freeText" bind:value={freeText}></textarea>
    </div>

    <button type="submit">エントリーする</button>
  </form>
{/if}
