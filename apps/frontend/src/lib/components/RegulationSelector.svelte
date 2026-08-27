<script lang="ts">
  import type {Regulation} from '@regional-quiz/shared';
  import {isRegulationSelectionAllowed} from '@regional-quiz/shared';

  interface Props {
    regulations: Regulation[];
    /**
     * The chosen regulation's id, or `null` while nothing is chosen. Bound,
     * so picking one writes it back to the caller — see "Form controls are
     * bound, not rendered from an expression" in `apps/frontend/README.md`.
     */
    value: string | null;
    now?: Date;
  }

  let {regulations, value = $bindable(), now = new Date()}: Props = $props();

  interface RegulationOption {
    regulation: Regulation;
    allowed: boolean;
  }

  const options = $derived(
    [...regulations]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(
        (regulation): RegulationOption => ({
          regulation,
          allowed: isRegulationSelectionAllowed(
            regulations,
            regulation.id,
            now,
          ),
        }),
      ),
  );
</script>

<fieldset class="regulation-selector">
  <legend>レギュレーションを選択してください</legend>
  {#each options as {regulation, allowed} (regulation.id)}
    <label class={{disabled: !allowed}}>
      <!-- `value` is the option this radio stands for; `bind:group` is what
           carries the chosen one back out. -->
      <input
        type="radio"
        name="regulationId"
        value={regulation.id}
        required
        disabled={!allowed}
        bind:group={value}
      />
      {regulation.label}
      {#if !allowed}
        <span class="regulation-disabled-reason"
          >優先期間中のため選択できません</span
        >
      {/if}
    </label>
  {/each}
</fieldset>
