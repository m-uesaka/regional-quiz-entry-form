<!--
@component
The outcome of something the visitor just did -- "saved", or why it was
refused -- as a `Message` holding one line of text.

`kind` decides both the look and how a screen reader hears it: an error is a
`danger` message announced at once (`role="alert"`), a success a `success`
message announced politely (`role="status"`).

Use `Message` directly for anything else: a notice that isn't the result of
an action, a different variant, or more than one line.

```svelte
<FlashMessage kind="error">{form.error}</FlashMessage>
```
-->
<script lang="ts">
  import type {Snippet} from 'svelte';
  import Message from './Message.svelte';

  interface Props {
    /** Whether the action failed or succeeded. */
    kind: 'error' | 'success';
    /** The text, which may contain inline elements such as a link. */
    children: Snippet;
  }

  const {kind, children}: Props = $props();

  const variant = $derived(kind === 'error' ? 'danger' : 'success');
  const role = $derived(kind === 'error' ? 'alert' : 'status');
</script>

<Message {variant}>
  <p {role} class="text-sm text-foreground">{@render children()}</p>
</Message>
