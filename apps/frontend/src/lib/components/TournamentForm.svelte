<script lang="ts">
  import type {Region} from '@regional-quiz/shared';
  import {datetimeLocalStep} from '$lib/jst-datetime';
  import type {TournamentFormValues} from '$lib/types/tournament-form';

  interface Props {
    // Every region a tournament may be filed under, read server-side by the
    // page so the id never has to be typed out by hand.
    regions: Region[];
    /**
     * What the controls should show: the stored tournament, or — after a
     * refused save — what was submitted.
     */
    values: TournamentFormValues;
    submitLabel: string;
    /** The named action to post to, or undefined for the page's default. */
    action?: string;
  }

  const {regions, values, submitLabel, action}: Props = $props();
</script>

<!-- Posted to a form action rather than sent from the browser: `/api/*` is
     only routed to the backend Worker for requests the frontend makes
     itself, so a client-side write would 404 in production until Task 9-5
     lands. See the note in this page's `+page.server.ts`. -->
<form class="tournament-form" method="POST" {action}>
  <label>
    地域
    <!-- A select rather than a UUID typed by hand: the id is not something
         anyone can check by eye, and a mistyped one files the tournament
         under a region nobody notices until its entry-form URL is wrong. -->
    <select name="regionId" value={values.regionId} required>
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
    <select name="type" value={values.type}>
      <option value="saikyoi">最強位</option>
      <option value="shinjinou">新人王</option>
    </select>
  </label>

  <label>
    大会名
    <input type="text" name="name" value={values.name} required />
  </label>

  <label>
    定員(空欄で無制限)
    <input type="number" name="capacity" min="1" value={values.capacity} />
  </label>

  <!-- The step only drops to a second for a stored instant that falls
       mid-minute, which the default minute step would refuse outright. -->
  <label>
    エントリー開始日時 (JST)
    <input
      type="datetime-local"
      name="entryOpensAt"
      step={datetimeLocalStep(values.entryOpensAt)}
      value={values.entryOpensAt}
      required
    />
  </label>

  <label>
    エントリー終了日時 (JST)
    <input
      type="datetime-local"
      name="entryClosesAt"
      step={datetimeLocalStep(values.entryClosesAt)}
      value={values.entryClosesAt}
      required
    />
  </label>

  <button type="submit">{submitLabel}</button>
</form>
