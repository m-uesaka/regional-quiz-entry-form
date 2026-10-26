<!--
@component
The 優先エントリー going on now, one line per window end, worded the same
on the portal and the entry form. Renders nothing when there is none.
-->
<script lang="ts">
  import type {ClassValue} from 'svelte/elements';
  import type {PriorityEntryNotice} from '$lib/priority-entry';

  interface Props {
    notices: PriorityEntryNotice[];
    class?: ClassValue;
  }

  const {notices, class: className}: Props = $props();
</script>

{#each notices as notice (notice.endsAtLabel)}
  <p class={['text-sm', className]}>
    現在優先エントリー実施中です。該当レギュレーション: {notice.labels
      .map(label => `「${label}」`)
      .join('')}、〜{notice.endsAtLabel}まで
  </p>
{/each}
