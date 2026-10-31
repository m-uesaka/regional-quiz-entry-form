<!--
@component
What the server said about a field, under the control it belongs to. Renders
nothing while there is no message, so a caller needn't guard it.

`TextField` uses this and wires it to its control; use it alone where a
message has no single text control to point at (a `<select>`, a group of
boxes, a rule across several fields).
-->
<script lang="ts">
  interface Props {
    /** The message; left out while nothing has been rejected. */
    error?: string;
    /** What a control's `aria-describedby` points at. */
    id?: string;
    /**
     * `alert` announces the message as it appears. Not the default: the
     * entry forms' only `alert` is the refusal at the top of the page, which
     * `apps/e2e` counts on being alone.
     */
    role?: 'alert';
  }

  const {error, id, role}: Props = $props();
</script>

{#if error}
  <p {id} {role} class="text-sm text-destructive">{error}</p>
{/if}
