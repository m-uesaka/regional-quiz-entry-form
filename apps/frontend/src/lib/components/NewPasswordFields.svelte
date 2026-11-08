<!--
@component
The two controls of a form that sets a new password -- `newPassword` and
`newPasswordConfirm` -- with `PasswordRequirements` checking them as they are
typed (#177). Shared by the participant and staff password-reset screens,
whose actions read the two controls by those names.
-->
<script lang="ts">
  import {PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH} from '@regional-quiz/shared';
  import PasswordRequirements from '$lib/components/PasswordRequirements.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';

  interface Props {
    /** The label of the new password control. */
    passwordLabel: string;
    /** The label of the confirmation control. */
    confirmationLabel: string;
  }

  let {passwordLabel, confirmationLabel}: Props = $props();

  // Bound so `PasswordRequirements` can check them as they are typed (#177).
  let newPassword = $state('');
  let newPasswordConfirm = $state('');
</script>

<div class="flex flex-col gap-1.5">
  <Label for="newPassword">{passwordLabel}</Label>
  <Input
    id="newPassword"
    name="newPassword"
    type="password"
    autocomplete="new-password"
    minlength={PASSWORD_MIN_LENGTH}
    maxlength={PASSWORD_MAX_LENGTH}
    bind:value={newPassword}
    aria-describedby="password-requirements"
    required
  />
</div>

<div class="flex flex-col gap-1.5">
  <Label for="newPasswordConfirm">{confirmationLabel}</Label>
  <Input
    id="newPasswordConfirm"
    name="newPasswordConfirm"
    type="password"
    autocomplete="new-password"
    minlength={PASSWORD_MIN_LENGTH}
    maxlength={PASSWORD_MAX_LENGTH}
    bind:value={newPasswordConfirm}
    required
  />
</div>

<div id="password-requirements">
  <PasswordRequirements
    password={newPassword}
    confirmation={newPasswordConfirm}
  />
</div>
