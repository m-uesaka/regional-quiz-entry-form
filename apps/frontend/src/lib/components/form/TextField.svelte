<!--
@component
A label, a text control and the server's message about it, with the control
pointed at the message through `aria-describedby` / `aria-invalid`. Everything
else (`type`, `maxlength`, `required`, ...) goes straight to the control; set
`multiline` for a `<textarea>`. `class` goes where `Input` and `Textarea` put
it: on the `<textarea>`, but on the wrapper around an `<input>`, which takes
`inputClass` instead.

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
  // that isn't there would describe the control as nothing at all. The message
  // comes first, as what went wrong is what someone coming back to the field
  // needs to hear, and it may come ahead of a long description.
  const describedBy = $derived(
    [error ? errorId : undefined, ariaDescribedby].filter(Boolean).join(' ') ||
      undefined,
  );
  // Written once for both controls, and last, so a caller's attributes can't
  // override what this component is here to keep in step.
  const controlAttributes = $derived({
    id,
    isError: !!error,
    'aria-describedby': describedBy,
    'aria-invalid': error ? ('true' as const) : undefined,
  });
</script>

<div class="flex flex-col gap-1.5">
  <Label for={id}>{label}</Label>
  {#if multiline}
    <!-- `multiline` is what picks the union's member, but TypeScript can't
         carry that over to a rest element. -->
    <Textarea {...rest as TextareaProps} {...controlAttributes} bind:value />
  {:else}
    <Input {...rest as InputProps} {...controlAttributes} bind:value />
  {/if}
  <FieldError {error} id={errorId} role={errorRole} />
</div>
