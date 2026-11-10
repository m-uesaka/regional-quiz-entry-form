<script lang="ts">
  import Message from '$lib/components/ui/items/Message.svelte';

  interface Props {
    /**
     * The warning about the address's accounts still waiting on their invite
     * link (`$lib/server/staff-pending-invites`), if any.
     */
    message?: string;
  }

  let {message}: Props = $props();
</script>

{#if message}
  <div class="mx-auto w-full max-w-5xl px-4 pt-4">
    <Message variant="warning">
      <p role="alert" class="text-sm">{message}</p>
    </Message>
  </div>
{/if}
