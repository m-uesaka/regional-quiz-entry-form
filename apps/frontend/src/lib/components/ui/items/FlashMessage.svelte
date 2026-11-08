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
  import Message, {type MessageVariants} from './Message.svelte';

  type Kind = 'error' | 'success';

  // Variant and role chosen together, so a new kind has to name both.
  const APPEARANCE = {
    error: {variant: 'danger', role: 'alert'},
    success: {variant: 'success', role: 'status'},
  } as const satisfies Record<
    Kind,
    {variant: MessageVariants['variant']; role: 'alert' | 'status'}
  >;

  interface Props {
    /** Whether the action failed or succeeded. */
    kind: Kind;
    /** The text, which may contain inline elements such as a link. */
    children: Snippet;
  }

  const {kind, children}: Props = $props();

  const appearance = $derived(APPEARANCE[kind]);
</script>

<Message variant={appearance.variant}>
  <p role={appearance.role} class="text-sm text-foreground">{@render children()}</p>
</Message>
