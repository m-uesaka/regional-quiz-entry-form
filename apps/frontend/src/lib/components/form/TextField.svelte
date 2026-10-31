<!--
@component
A label, a text control and the server's message about it, with the control
pointed at the message through `aria-describedby` / `aria-invalid`. Everything
else (`type`, `maxlength`, `required`, `class`, ...) goes straight to the
control; set `multiline` for a `<textarea>`.

`value` stays the caller's: `bind:value` to `$state` it seeded, or pass a
starting value. Either way the control underneath is bound, which is what
keeps what a visitor typed before hydration — see "Form controls are bound,
not rendered from an expression" in `apps/frontend/README.md`.
-->
<script lang="ts">
  import FieldError from '$lib/components/form/FieldError.svelte';
  import Input, {type InputProps} from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Textarea, {
    type TextareaProps,
  } from '$lib/components/ui/atoms/Textarea.svelte';

  interface FieldProps {
    /** The control's `id`, which the label's `for` and the message's follow. */
    id: string;
    name: string;
    label: string;
    /** The message; left out while nothing has been rejected. */
    error?: string;
    /** See `FieldError`. */
    errorRole?: 'alert';
    value?: string;
    /** Anything else describing the control; the message is added to it. */
    'aria-describedby'?: string;
  }

  /** What this component derives itself rather than takes from a caller. */
  type DerivedAttributes = keyof FieldProps | 'isError' | 'aria-invalid';

  interface InputFieldProps
    extends FieldProps, Omit<InputProps, DerivedAttributes> {
    multiline?: false;
  }

  interface TextareaFieldProps
    extends FieldProps, Omit<TextareaProps, DerivedAttributes> {
    multiline: true;
  }

  type Props = InputFieldProps | TextareaFieldProps;

  let {
    id,
    label,
    error,
    errorRole,
    multiline,
    value = $bindable(''),
    'aria-describedby': ariaDescribedby,
    ...rest
  }: Props = $props();

  const errorId = $derived(`${id}-error`);
  // Names the message only while it is on the page: a reference to an element
  // that isn't there would describe the control as nothing at all.
  const describedBy = $derived(
    [ariaDescribedby, error ? errorId : undefined].filter(Boolean).join(' ') ||
      undefined,
  );
  const invalid = $derived(error ? 'true' : undefined);
</script>

<div class="flex flex-col gap-1.5">
  <Label for={id}>{label}</Label>
  {#if multiline}
    <!-- `multiline` is what picks the union's member, but TypeScript can't
         carry that over to a rest element. -->
    <Textarea
      {id}
      {...rest as TextareaProps}
      isError={!!error}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      bind:value
    />
  {:else}
    <Input
      {id}
      {...rest as InputProps}
      isError={!!error}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      bind:value
    />
  {/if}
  <FieldError {error} id={errorId} role={errorRole} />
</div>
