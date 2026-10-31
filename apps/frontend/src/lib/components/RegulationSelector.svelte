<script lang="ts">
  import type {EntryPeriod, Regulation} from '@regional-quiz/shared';
  import {
    isRegulationSelectionAllowed,
    selectableRegulations,
  } from '@regional-quiz/shared';

  interface Props {
    regulations: Regulation[];
    /** The tournament's entry period. */
    entryPeriod: EntryPeriod;
    /**
     * The chosen regulations' ids. Bound, so checking one writes it back to
     * the caller — see "Form controls are bound, not rendered from an
     * expression" in `apps/frontend/README.md`.
     */
    value: string[];
    now?: Date;
  }

  let {
    regulations,
    entryPeriod,
    value = $bindable(),
    now = new Date(),
  }: Props = $props();

  // Only what is on offer, in order. `regulations` itself stays the whole
  // list for the checks below, which need the phases that are over.
  const ordered = $derived(
    selectableRegulations(regulations, now, entryPeriod).sort(
      (a, b) => a.displayOrder - b.displayOrder,
    ),
  );
  // What a rejected submission echoed back can name a regulation the page no
  // longer shows; it doesn't count as chosen.
  const chosen = $derived(
    value.filter(id => ordered.some(regulation => regulation.id === id)),
  );

  // Which regulations are inside an active priority window. During one, the
  // participant has to claim at least one of them — but may claim others
  // alongside it, since meeting a second condition doesn't stop them
  // meeting the priority one. So nothing is disabled; the requirement is
  // reported instead.
  const priorityIds = $derived(
    new Set(
      ordered
        .filter(regulation =>
          isRegulationSelectionAllowed(
            regulations,
            [regulation.id],
            now,
            entryPeriod,
          ),
        )
        .map(regulation => regulation.id),
    ),
  );
  const hasPriorityWindow = $derived(priorityIds.size < ordered.length);
  const selectionAllowed = $derived(
    isRegulationSelectionAllowed(regulations, chosen, now, entryPeriod),
  );

  // A checkbox group has no native "at least one checked", so every box
  // carries `required` while none is checked and loses it once one is —
  // the same trick `DynamicFormField` uses, including the reason it can
  // only be installed after hydration: dropping the attribute again takes a
  // re-render, so a server-rendered `required` would be one the browser
  // silently refuses to submit past with JS off (#95). The action's own
  // `EntryInputSchema` check answers such a submission with a message
  // either way.
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });
</script>

<!-- Native checkboxes inside their own `<label>`: the label (badge
     included) is what names each one, and a native box is what `bind:group`
     and the post-hydration `required` act on. -->
<fieldset class="flex flex-col gap-2">
  <legend class="mb-1.5 text-sm/tight font-medium text-foreground">
    レギュレーションを選択してください(複数選択可)
  </legend>
  {#if hasPriorityWindow}
    <p class="text-sm text-muted-foreground">
      現在は優先期間中です。優先対象のレギュレーションを1つ以上選択してください
    </p>
  {/if}
  {#each ordered as regulation (regulation.id)}
    <label class="flex w-fit cursor-pointer flex-wrap items-center gap-2 text-sm">
      <!-- `value` is the option this checkbox stands for; `bind:group` is
           what carries the chosen set back out. -->
      <input
        type="checkbox"
        class="size-4 cursor-pointer accent-primary"
        name="regulationIds"
        value={regulation.id}
        required={hydrated && chosen.length === 0}
        bind:group={value}
      />
      {regulation.label}
      {#if priorityIds.has(regulation.id) && hasPriorityWindow}
        <span
          class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs/none font-semibold text-primary"
          >優先対象</span
        >
      {/if}
    </label>
  {/each}
  {#if !selectionAllowed && chosen.length > 0}
    <p class="text-sm text-destructive">
      現在は優先期間中のため、優先対象のレギュレーションを1つ以上選択してください
    </p>
  {/if}
</fieldset>
