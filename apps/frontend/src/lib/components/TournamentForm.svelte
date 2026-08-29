<script lang="ts">
  import {untrack} from 'svelte';
  import type {Region, TournamentType} from '@regional-quiz/shared';
  import type {
    TournamentFormInitialValues,
    TournamentFormValues,
  } from '$lib/types/tournament-form';

  interface Props {
    // Every region a tournament may be filed under, read server-side by the
    // page so the id never has to be typed out by hand.
    regions: Region[];
    initialValues?: TournamentFormInitialValues;
    submitLabel: string;
    // Returns an error message to display, or `null` on success.
    onSubmit: (values: TournamentFormValues) => Promise<string | null>;
  }

  const {regions, initialValues = {}, submitLabel, onSubmit}: Props = $props();

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
  // An empty number input binds as `null` rather than as `0`, which is
  // exactly the "no limit" the API takes.
  let capacity = $state<number | null>(initial.capacity ?? null);
  let entryOpensAt = $state(toDatetimeLocalValue(initial.entryOpensAt));
  let entryClosesAt = $state(toDatetimeLocalValue(initial.entryClosesAt));
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    submitting = true;
    error = null;
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
    地域
    <!-- A select rather than a UUID typed by hand: the id is not something
         anyone can check by eye, and a mistyped one files the tournament
         under a region nobody notices until its entry-form URL is wrong. -->
    <select bind:value={regionId} required>
      <option value="" disabled>選択してください</option>
      {#each regions as region (region.id)}
        <option value={region.id}>{region.name}</option>
      {/each}
    </select>
  </label>

  {#if regions.length === 0}
    <p class="tournament-form-error" role="alert">
      地域が登録されていません。先に<a href="/admin/regions">地域の管理</a>
      から追加してください。
    </p>
  {/if}

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
    <input type="number" min="1" bind:value={capacity} />
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
