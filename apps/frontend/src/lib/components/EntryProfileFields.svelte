<!--
@component
The fields every entry has whichever form it is filled in on: the names and
the free text. Renders no wrapper of its own, so the fields stay direct
children of the form's layout.

The free text doesn't sit in the same place on both forms: `children` is what
a form puts between the names and it.

The values are bound, and seeded by the form that owns them. This component
holds no state of its own, so nothing here can reset what is being typed when
a rejected submission re-renders the form. See "A seeded form lives in a child
component" in `apps/frontend/README.md`.
-->
<script lang="ts">
  import type {Snippet} from 'svelte';
  import {
    ENTRY_FREE_TEXT_MAX_LENGTH,
    ENTRY_NAME_MAX_LENGTH,
  } from '@regional-quiz/shared';
  import TextField from '$lib/components/form/TextField.svelte';
  import {firstFieldError} from '$lib/entry-form';
  import type {EntryFieldErrors} from '$lib/types/entry-form';

  interface Props {
    name: string;
    furigana: string;
    displayName: string;
    freeText: string;
    fieldErrors?: EntryFieldErrors;
    /** What goes between the names and the free text. */
    children?: Snippet;
  }

  let {
    name = $bindable(),
    furigana = $bindable(),
    displayName = $bindable(),
    freeText = $bindable(),
    fieldErrors,
    children,
  }: Props = $props();
</script>

<TextField
  id="name"
  name="name"
  label="氏名"
  bind:value={name}
  maxlength={ENTRY_NAME_MAX_LENGTH}
  error={firstFieldError(fieldErrors, 'name')}
  required
/>

<TextField
  id="furigana"
  name="furigana"
  label="ふりがな"
  bind:value={furigana}
  maxlength={ENTRY_NAME_MAX_LENGTH}
  error={firstFieldError(fieldErrors, 'furigana')}
  required
/>

<TextField
  id="displayName"
  name="displayName"
  label="エントリーリスト掲載名"
  bind:value={displayName}
  maxlength={ENTRY_NAME_MAX_LENGTH}
  error={firstFieldError(fieldErrors, 'displayName')}
  required
/>

{@render children?.()}

<TextField
  id="freeText"
  name="freeText"
  label="自由記述"
  multiline
  bind:value={freeText}
  maxlength={ENTRY_FREE_TEXT_MAX_LENGTH}
  error={firstFieldError(fieldErrors, 'freeText')}
/>
