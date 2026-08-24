<script lang="ts">
  import {untrack} from 'svelte';
  import type {TournamentType} from '@regional-quiz/shared';
  import type {
    TournamentFormInitialValues,
    TournamentFormValues,
  } from '$lib/types/tournament-form';

  interface Props {
    initialValues?: TournamentFormInitialValues;
    submitLabel: string;
    // Returns an error message to display, or `null` on success.
    onSubmit: (values: TournamentFormValues) => Promise<string | null>;
  }

  const {initialValues = {}, submitLabel, onSubmit}: Props = $props();

  // Converts an ISO datetime string into the `YYYY-MM-DDTHH:mm` value a
  // `datetime-local` input expects.
  function toDatetimeLocalValue(iso?: string): string {
    if (!iso) {
      return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  // `initialValues` only seeds the form once — this is an uncontrolled
  // form, so later prop changes intentionally don't overwrite in-progress
  // user edits. `untrack` documents that and avoids Svelte's
  // `state_referenced_locally` warning, which otherwise assumes every read
  // of a prop inside a `$state` initializer should stay in sync.
  const initial = untrack(() => initialValues);

  let regionId = $state(initial.regionId ?? '');
  let type = $state<TournamentType>(initial.type ?? 'saikyoi');
  let name = $state(initial.name ?? '');
  // Kept as free text (not bound as a number input) so an empty field can be
  // distinguished from `0` and mapped to `capacity: null` on submit.
  let capacityInput = $state(
    initial.capacity != null ? String(initial.capacity) : '',
  );
  let entryOpensAt = $state(toDatetimeLocalValue(initial.entryOpensAt));
  let entryClosesAt = $state(toDatetimeLocalValue(initial.entryClosesAt));
  let submitting = $state(false);
  let error = $state<string | null>(null);

  function handleCapacityInput(event: Event): void {
    capacityInput = (event.currentTarget as HTMLInputElement).value;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    submitting = true;
    error = null;
    const capacity =
      capacityInput.trim() === '' ? null : Number(capacityInput);
    try {
      error = await onSubmit({
        regionId,
        type,
        name,
        capacity,
        entryOpensAt: new Date(entryOpensAt).toISOString(),
        entryClosesAt: new Date(entryClosesAt).toISOString(),
      });
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : '送信に失敗しました';
    } finally {
      submitting = false;
    }
  }
</script>

<form class="tournament-form" onsubmit={handleSubmit}>
  <label>
    地域ID (regionId)
    <input
      type="text"
      bind:value={regionId}
      required
      placeholder="00000000-0000-0000-0000-000000000000"
    />
  </label>

  <label>
    種別
    <select bind:value={type}>
      <option value="saikyoi">最強位</option>
      <option value="shinjinou">新人王</option>
    </select>
  </label>

  <label>
    大会名
    <input type="text" bind:value={name} required />
  </label>

  <label>
    定員(空欄で無制限)
    <input
      type="number"
      min="1"
      value={capacityInput}
      oninput={handleCapacityInput}
    />
  </label>

  <label>
    エントリー開始日時
    <input type="datetime-local" bind:value={entryOpensAt} required />
  </label>

  <label>
    エントリー終了日時
    <input type="datetime-local" bind:value={entryClosesAt} required />
  </label>

  {#if error}
    <p class="tournament-form-error" role="alert">{error}</p>
  {/if}

  <button type="submit" disabled={submitting}>{submitLabel}</button>
</form>
