<!--
@component
A custom form field's label (or one of its choices), with the
`<a href="https://...">` links staff wrote into it rendered as links (#173)
and everything else as text. The label is never put on the page as HTML:
`parseLabelLinks()` picks out the one link shape it accepts, and any other
markup stays literal text.

The segments sit in one `<span>`, so a flex container this is placed in (a
checkbox's `<label>`, `Label`) lays the label out as a single item that
wraps as one run of text, rather than spacing each segment apart.

Links open in a new tab, so following one from inside a `<label>` doesn't
leave the half-filled form behind.
-->
<script lang="ts">
  import {parseLabelLinks} from '@regional-quiz/shared';
  import Link from '$lib/components/ui/atoms/Link.svelte';

  interface Props {
    label: string;
  }

  let {label}: Props = $props();

  const segments = $derived(parseLabelLinks(label));
</script>

<span
  >{#each segments as segment}{#if segment.kind === 'link'}<Link
        href={segment.href}
        target="_blank">{segment.text}</Link
      >{:else}{segment.text}{/if}{/each}</span
>
