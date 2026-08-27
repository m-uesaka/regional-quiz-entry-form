<script lang="ts">
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
  // re-renders that rather than emptying itself.
  const values = $derived(form?.values);

  function fieldError(field: string): string | undefined {
    return form?.fieldErrors?.[field]?.[0];
  }

  // The submitted body is rebuilt server-side from the named inputs
  // `DynamicFormField` and `RegulationSelector` render, so this state only
  // drives what those components show as currently selected. Seeded once
  // (through a function, so it isn't read as a reactive dependency) and
  // owned by the form from then on.
  function initialCustomFieldValues(): Record<string, string | string[]> {
    return {...(form?.values?.customFieldValues ?? {})};
  }

  // Seeded the same way, and for the same reason, as `customFieldValues`.
  function initialRegulationId(): string | null {
    return form?.values?.regulationId ?? null;
  }

  let customFieldValues = $state(initialCustomFieldValues());
  let regulationId = $state(initialRegulationId());

  function valueFor(key: string): string | string[] {
    return customFieldValues[key] ?? '';
  }

  function setValue(key: string, value: string | string[]): void {
    customFieldValues = {...customFieldValues, [key]: value};
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
      <input id="name" name="name" value={values?.name ?? ''} required />
      {#if fieldError('name')}<p class="field-error">{fieldError('name')}</p>{/if}
    </div>

    <div class="form-field">
      <label for="furigana">ふりがな</label>
      <input
        id="furigana"
        name="furigana"
        value={values?.furigana ?? ''}
        required
      />
      {#if fieldError('furigana')}
        <p class="field-error">{fieldError('furigana')}</p>
      {/if}
    </div>

    <div class="form-field">
      <label for="displayName">掲載名</label>
      <input
        id="displayName"
        name="displayName"
        value={values?.displayName ?? ''}
        required
      />
      {#if fieldError('displayName')}
        <p class="field-error">{fieldError('displayName')}</p>
      {/if}
    </div>

    <div class="form-field">
      <label for="email">メールアドレス</label>
      <input
        id="email"
        name="email"
        type="email"
        value={values?.email ?? ''}
        required
      />
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
      value={regulationId}
      onChange={value => (regulationId = value)}
    />
    {#if fieldError('regulationId')}
      <p class="field-error">{fieldError('regulationId')}</p>
    {/if}

    {#each fields as field (field.key)}
      <DynamicFormField
        {field}
        value={valueFor(field.key)}
        onChange={value => setValue(field.key, value)}
      />
    {/each}

    <div class="form-field">
      <label for="freeText">自由記述</label>
      <textarea id="freeText" name="freeText" value={values?.freeText ?? ''}
      ></textarea>
    </div>

    <button type="submit">エントリーする</button>
  </form>
{/if}
