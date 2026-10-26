<!--
@component
A native `<select>` styled like Rabee UI's `Input`.

Rabee UI's own `Select` is a custom listbox with no `<select>` behind it, so
its value is never part of a form submission and `selectOptions()` in the
tests cannot drive it. Use this one inside forms; pass `<option>`s as
children.
-->
<script lang="ts">
  import type {HTMLSelectAttributes} from 'svelte/elements';
  import {inputVariants} from '$lib/components/ui/atoms/Input.svelte';

  interface Props extends HTMLSelectAttributes {
    isError?: boolean;
  }

  let {
    value = $bindable(),
    isError = false,
    class: className,
    children,
    ...rest
  }: Props = $props();
</script>

<select
  class={[
    inputVariants({isError, disabled: rest.disabled ?? false}),
    'cursor-pointer appearance-auto',
    className,
  ]}
  bind:value
  {...rest}
>
  {@render children?.()}
</select>
