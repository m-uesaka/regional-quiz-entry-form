<!--
@component
The names every entry has whichever form it is filled in on: 氏名, ふりがな and
the name printed on the entry list. Renders no wrapper of its own, so the
fields stay direct children of the form's layout. The free text, which the two
forms place differently, is `EntryFreeTextField`.

The values are bound, and seeded by the form that owns them. This component
holds no state of its own, so nothing here can reset what is being typed when
a rejected submission re-renders the form. See "A seeded form lives in a child
component" in `apps/frontend/README.md`.
-->
<script lang="ts">
  import {ENTRY_NAME_MAX_LENGTH, maxLengthAttribute} from '@regional-quiz/shared';
  import TextField from '$lib/components/form/TextField.svelte';
  import {firstFieldError} from '$lib/entry-form';
  import type {EntryFieldErrors} from '$lib/types/entry-form';

  interface Props {
    name: string;
    furigana: string;
    displayName: string;
    fieldErrors?: EntryFieldErrors;
  }

  let {
    name = $bindable(),
    furigana = $bindable(),
    displayName = $bindable(),
    fieldErrors,
  }: Props = $props();
</script>

<TextField
  id="name"
  name="name"
  label="氏名"
  bind:value={name}
  maxlength={maxLengthAttribute(ENTRY_NAME_MAX_LENGTH)}
  error={firstFieldError(fieldErrors, 'name')}
  required
/>

<TextField
  id="furigana"
  name="furigana"
  label="ふりがな"
  bind:value={furigana}
  maxlength={maxLengthAttribute(ENTRY_NAME_MAX_LENGTH)}
  error={firstFieldError(fieldErrors, 'furigana')}
  required
/>

<TextField
  id="displayName"
  name="displayName"
  label="エントリーリスト掲載名"
  bind:value={displayName}
  maxlength={maxLengthAttribute(ENTRY_NAME_MAX_LENGTH)}
  error={firstFieldError(fieldErrors, 'displayName')}
  required
/>
