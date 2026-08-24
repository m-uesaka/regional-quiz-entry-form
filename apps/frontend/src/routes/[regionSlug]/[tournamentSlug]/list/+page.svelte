<script lang="ts">
  import type {PageProps} from './$types';
  let {data}: PageProps = $props();
</script>

<ul>
  {#each data.entries as entry, i (i)}
    <li>
      {entry.displayName}
      {#if entry.status === 'waitlisted'}(キャンセル待ち {entry.waitlistPosition}){/if}
    </li>
  {/each}
</ul>
