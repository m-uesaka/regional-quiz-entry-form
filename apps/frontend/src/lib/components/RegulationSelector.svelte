<script lang="ts">
  import type {Regulation} from '@regional-quiz/shared';
  import {isRegulationSelectionAllowed} from '@regional-quiz/shared';

  interface Props {
    regulations: Regulation[];
    value: string | null;
    onChange: (value: string) => void;
    now?: Date;
  }

  const {regulations, value, onChange, now = new Date()}: Props = $props();

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
      <input
        type="radio"
        name="regulationId"
        value={regulation.id}
        required
        disabled={!allowed}
        checked={value === regulation.id}
        onchange={() => onChange(regulation.id)}
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
