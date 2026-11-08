<!--
@component
The free text every entry has, optional. Its own component because the two
entry forms put it in different places: last on the entry form, right after
the names on the edit form.

The value is bound, and seeded by the form that owns it. See "A seeded form
lives in a child component" in `apps/frontend/README.md`.
-->
<script lang="ts">
  import {ENTRY_FREE_TEXT_MAX_LENGTH} from '@regional-quiz/shared';
  import TextField from '$lib/components/form/TextField.svelte';
  import {firstFieldError} from '$lib/entry-form';
  import type {EntryFieldErrors} from '$lib/types/entry-form';

  interface Props {
    freeText: string;
    fieldErrors?: EntryFieldErrors;
  }

  let {freeText = $bindable(), fieldErrors}: Props = $props();
</script>

<TextField
  id="freeText"
  name="freeText"
  label="自由記述"
  multiline
  bind:value={freeText}
  maxlength={ENTRY_FREE_TEXT_MAX_LENGTH}
  error={firstFieldError(fieldErrors, 'freeText')}
/>
