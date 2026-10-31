<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import {invalidateAll} from '$app/navigation';
  import {
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    type FormFieldDef,
    type EntryPeriod,
    type Regulation,
  } from '@regional-quiz/shared';
  import CustomFieldsSection from '$lib/components/CustomFieldsSection.svelte';
  import EntryProfileFields from '$lib/components/EntryProfileFields.svelte';
  import FieldError from '$lib/components/form/FieldError.svelte';
  import TextField from '$lib/components/form/TextField.svelte';
  import PasswordRequirements from '$lib/components/PasswordRequirements.svelte';
  import {firstFieldError, initialCustomFieldValues} from '$lib/entry-form';
  import RegulationSelector from '$lib/components/RegulationSelector.svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import type {EntryFieldErrors, EntryFormValues} from '$lib/types/entry-form';

  interface Props {
    formFieldDefs: FormFieldDef[];
    regulations: Regulation[];
    /** The tournament's entry period. */
    entryPeriod: EntryPeriod;
    /** The moment `load` read, which decides the regulations on offer. */
    now: Date;
    /** What the last rejected submission carried back, if there was one. */
    values?: EntryFormValues;
    fieldErrors?: EntryFieldErrors;
    /**
     * Whether a participant is logged in. They enter under their session,
     * so the address and password fields are left out (#117).
     */
    loggedIn?: boolean;
    /**
     * Whether this is a staff preview of a form outside its entry period.
     * The API would refuse the submission, so the form is shown without a
     * way to send it: no submit, and no challenge spent on one.
     */
    preview?: boolean;
  }

  const {
    formFieldDefs,
    regulations,
    entryPeriod,
    now,
    values,
    fieldErrors,
    loggedIn = false,
    preview = false,
  }: Props = $props();

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
  let customFieldValues = $state(
    untrack(() =>
      initialCustomFieldValues(formFieldDefs, initial?.customFieldValues),
    ),
  );
  let turnstile = $state<ReturnType<typeof Turnstile>>();
</script>

<!-- The `enhance` callback is only here to hand the challenge back: a
     rejected submission is reported with `fail()`, which re-renders this
     form in place with the token it already spent still in it, and the
     retry the message invites would then fail the challenge rather than
     whatever it was actually refused for. See `Turnstile.svelte`. A refusal
     because the regulations changed also reads the page data again: `fail()`
     doesn't, and the form would go on offering what was just refused. What
     was typed stays, as the controls own their values. -->
<form
  method="POST"
  class="flex flex-col gap-4"
  use:enhance={() => {
    return async ({result, update}) => {
      await update();
      if (result.type === 'failure' && result.data?.regulationsChanged) {
        await invalidateAll();
      }
      turnstile?.reset();
    };
  }}
>
  <!-- Everything between the names and the free text is this form's own, in
       the order a participant goes through it. -->
  <EntryProfileFields
    bind:name
    bind:furigana
    bind:displayName
    bind:freeText
    {fieldErrors}
  >
    {#if loggedIn}
      <!-- Tells the action this form was rendered for a session, so a session
           that lapsed while it was open is sent to log in again rather than
           told about address and password fields it never showed. -->
      <input type="hidden" name="entryMode" value="session" />
      <p class="text-sm text-muted-foreground">
        ログイン中のアカウントでエントリーします。メールアドレスとパスワードの入力は不要です。
      </p>
    {:else}
      <TextField
        id="email"
        name="email"
        label="メールアドレス"
        type="email"
        bind:value={email}
        error={firstFieldError(fieldErrors, 'email')}
        required
      />

      <!-- An address that is already registered is still recognised by its
           password, but a wrong one isn't reported on this page: the
           submission is answered the same whatever the address, and the
           reason goes to its owner by mail (#117). Registered participants
           are pointed at logging in instead, which leaves these fields out. -->
      <TextField
        id="password"
        name="password"
        label="パスワード"
        type="password"
        minlength={PASSWORD_MIN_LENGTH}
        maxlength={PASSWORD_MAX_LENGTH}
        autocomplete="new-password"
        error={firstFieldError(fieldErrors, 'password')}
        bind:value={password}
        aria-describedby="password-requirements"
        required
      />

      <TextField
        id="passwordConfirm"
        name="passwordConfirm"
        label="パスワード(確認)"
        type="password"
        minlength={PASSWORD_MIN_LENGTH}
        maxlength={PASSWORD_MAX_LENGTH}
        autocomplete="new-password"
        error={firstFieldError(fieldErrors, 'passwordConfirm')}
        bind:value={passwordConfirm}
        required
      />

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
      <RegulationSelector
        {regulations}
        {entryPeriod}
        {now}
        bind:value={regulationIds}
      />
      <FieldError error={firstFieldError(fieldErrors, 'regulationIds')} />
    </div>

    <CustomFieldsSection
      {formFieldDefs}
      bind:values={customFieldValues}
      {fieldErrors}
    />
  </EntryProfileFields>

  <!-- The widget drops a hidden `cf-turnstile-response` control into this
       form, which the page's action forwards to the API. Entry registration
       mails a confirmation to whatever address it is given, so it is one of
       the two forms behind a challenge as well as a rate limit (#116). -->
  {#if !preview}
    <Turnstile bind:this={turnstile} />
  {/if}

  <!-- Disabling the form's only submit button also stops Enter in a field
       from submitting it. -->
  <div class="flex flex-wrap gap-2 pt-2">
    <Button
      type="submit"
      variant="primary"
      tone="solid"
      size="large"
      disabled={preview}
    >
      エントリーする
    </Button>
  </div>
</form>
