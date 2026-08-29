<script lang="ts">
  import type {Regulation} from '@regional-quiz/shared';
  import {isRegulationSelectionAllowed} from '@regional-quiz/shared';

  interface Props {
    regulations: Regulation[];
    /**
     * The chosen regulations' ids. Bound, so checking one writes it back to
     * the caller — see "Form controls are bound, not rendered from an
     * expression" in `apps/frontend/README.md`.
     */
    value: string[];
    now?: Date;
  }

  let {regulations, value = $bindable(), now = new Date()}: Props = $props();

  const ordered = $derived(
    [...regulations].sort((a, b) => a.displayOrder - b.displayOrder),
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
          isRegulationSelectionAllowed(regulations, [regulation.id], now),
        )
        .map(regulation => regulation.id),
    ),
  );
  const hasPriorityWindow = $derived(priorityIds.size < ordered.length);
  const selectionAllowed = $derived(
    isRegulationSelectionAllowed(regulations, value, now),
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

<fieldset class="regulation-selector">
  <legend>レギュレーションを選択してください(複数選択可)</legend>
  {#if hasPriorityWindow}
    <p class="regulation-priority-notice">
      現在は優先期間中です。優先対象のレギュレーションを1つ以上選択してください
    </p>
  {/if}
  {#each ordered as regulation (regulation.id)}
    <label>
      <!-- `value` is the option this checkbox stands for; `bind:group` is
           what carries the chosen set back out. -->
      <input
        type="checkbox"
        name="regulationIds"
        value={regulation.id}
        required={hydrated && value.length === 0}
        bind:group={value}
      />
      {regulation.label}
      {#if priorityIds.has(regulation.id) && hasPriorityWindow}
        <span class="regulation-priority-badge">優先対象</span>
      {/if}
    </label>
  {/each}
  {#if !selectionAllowed && value.length > 0}
    <p class="field-error">
      現在は優先期間中のため、優先対象のレギュレーションを1つ以上選択してください
    </p>
  {/if}
</fieldset>
