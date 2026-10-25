<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {
    ENTRY_FREE_TEXT_MAX_LENGTH,
    ENTRY_NAME_MAX_LENGTH,
    toFormFieldDefYaml,
    type FormFieldDef,
    type Regulation,
  } from '@regional-quiz/shared';
  import DynamicFormField from '$lib/components/DynamicFormField.svelte';
  import PasswordRequirements from '$lib/components/PasswordRequirements.svelte';
  import {customFieldName} from '$lib/custom-field-name';
  import RegulationSelector from '$lib/components/RegulationSelector.svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Textarea from '$lib/components/ui/atoms/Textarea.svelte';
  import type {EntryFieldErrors, EntryFormValues} from '$lib/types/entry-form';

  interface Props {
    formFieldDefs: FormFieldDef[];
    regulations: Regulation[];
    /** What the last rejected submission carried back, if there was one. */
    values?: EntryFormValues;
    fieldErrors?: EntryFieldErrors;
    /**
     * Whether a participant is logged in. They enter under their session,
     * so the address and password fields are left out (#117).
     */
    loggedIn?: boolean;
  }

  const {
    formFieldDefs,
    regulations,
    values,
    fieldErrors,
    loggedIn = false,
  }: Props = $props();

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

  // Bound only so `PasswordRequirements` can say, as they are typed, whether
  // they will be accepted (#177). Never seeded: the action doesn't echo
  // passwords back.
  let password = $state('');
  let passwordConfirm = $state('');

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
  class="flex flex-col gap-4"
  use:enhance={() => {
    return async ({update}) => {
      await update();
      turnstile?.reset();
    };
  }}
>
  <div class="flex flex-col gap-1.5">
    <Label for="name">氏名</Label>
    <Input
      id="name"
      name="name"
      bind:value={name}
      maxlength={ENTRY_NAME_MAX_LENGTH}
      isError={!!fieldError('name')}
      required
    />
    {#if fieldError('name')}
      <p class="text-sm text-destructive">{fieldError('name')}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <Label for="furigana">ふりがな</Label>
    <Input
      id="furigana"
      name="furigana"
      bind:value={furigana}
      maxlength={ENTRY_NAME_MAX_LENGTH}
      isError={!!fieldError('furigana')}
      required
    />
    {#if fieldError('furigana')}
      <p class="text-sm text-destructive">{fieldError('furigana')}</p>
    {/if}
  </div>

  <div class="flex flex-col gap-1.5">
    <Label for="displayName">エントリーリスト掲載名</Label>
    <Input
      id="displayName"
      name="displayName"
      bind:value={displayName}
      maxlength={ENTRY_NAME_MAX_LENGTH}
      isError={!!fieldError('displayName')}
      required
    />
    {#if fieldError('displayName')}
      <p class="text-sm text-destructive">{fieldError('displayName')}</p>
    {/if}
  </div>

  {#if loggedIn}
    <!-- Tells the action this form was rendered for a session, so a session
         that lapsed while it was open is sent to log in again rather than
         told about address and password fields it never showed. -->
    <input type="hidden" name="entryMode" value="session" />
    <p class="text-sm text-muted-foreground">
      ログイン中のアカウントでエントリーします。メールアドレスとパスワードの入力は不要です。
    </p>
  {:else}
    <div class="flex flex-col gap-1.5">
      <Label for="email">メールアドレス</Label>
      <Input
        id="email"
        name="email"
        type="email"
        bind:value={email}
        isError={!!fieldError('email')}
        required
      />
      {#if fieldError('email')}
        <p class="text-sm text-destructive">{fieldError('email')}</p>
      {/if}
    </div>

    <!-- An address that is already registered is still recognised by its
         password, but a wrong one isn't reported on this page: the
         submission is answered the same whatever the address, and the
         reason goes to its owner by mail (#117). Registered participants
         are pointed at logging in instead, which leaves these fields out. -->
    <div class="flex flex-col gap-1.5">
      <Label for="password">パスワード</Label>
      <Input
        id="password"
        name="password"
        type="password"
        minlength={8}
        autocomplete="new-password"
        isError={!!fieldError('password')}
        bind:value={password}
        aria-describedby="password-requirements"
        required
      />
      {#if fieldError('password')}
        <p class="text-sm text-destructive">{fieldError('password')}</p>
      {/if}
    </div>

    <div class="flex flex-col gap-1.5">
      <Label for="passwordConfirm">パスワード(確認)</Label>
      <Input
        id="passwordConfirm"
        name="passwordConfirm"
        type="password"
        minlength={8}
        autocomplete="new-password"
        isError={!!fieldError('passwordConfirm')}
        bind:value={passwordConfirm}
        required
      />
      {#if fieldError('passwordConfirm')}
        <p class="text-sm text-destructive">{fieldError('passwordConfirm')}</p>
      {/if}
    </div>

    <!-- Under both fields, so the match is reported next to the second. The
         rules apply only when the address turns out to be new; a registered
         participant types the password they already have (#117). -->
    <div id="password-requirements">
      <PasswordRequirements
        {password}
        confirmation={passwordConfirm}
        newAccountOnly
      />
    </div>
  {/if}

  <div class="flex flex-col gap-1.5">
    <RegulationSelector {regulations} bind:value={regulationIds} />
    {#if fieldError('regulationIds')}
      <p class="text-sm text-destructive">{fieldError('regulationIds')}</p>
    {/if}
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
  <!-- Every answer within its own bound can still add up past the combined
       one; that has no single control to point at. -->
  {#if fieldError('customFieldValues')}
    <p class="text-sm text-destructive">{fieldError('customFieldValues')}</p>
  {/if}

  <div class="flex flex-col gap-1.5">
    <Label for="freeText">自由記述</Label>
    <Textarea
      id="freeText"
      name="freeText"
      bind:value={freeText}
      maxlength={ENTRY_FREE_TEXT_MAX_LENGTH}
      isError={!!fieldError('freeText')}
    />
    {#if fieldError('freeText')}
      <p class="text-sm text-destructive">{fieldError('freeText')}</p>
    {/if}
  </div>

  <!-- The widget drops a hidden `cf-turnstile-response` control into this
       form, which the page's action forwards to the API. Entry registration
       mails a confirmation to whatever address it is given, so it is one of
       the two forms behind a challenge as well as a rate limit (#116). -->
  <Turnstile bind:this={turnstile} />

  <div class="flex flex-wrap gap-2 pt-2">
    <Button type="submit" variant="primary" tone="solid" size="large">
      エントリーする
    </Button>
  </div>
</form>
