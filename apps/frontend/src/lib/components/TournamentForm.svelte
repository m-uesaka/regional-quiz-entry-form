<script lang="ts">
  import type {Region} from '@regional-quiz/shared';
  import NativeSelect from '$lib/components/form/NativeSelect.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
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
<form class="flex flex-col gap-4" method="POST" {action}>
  <div class="flex flex-col gap-1.5">
    <Label for="tournament-region">地域</Label>
    <!-- A select rather than a UUID typed by hand: the id is not something
         anyone can check by eye, and a mistyped one files the tournament
         under a region nobody notices until its entry-form URL is wrong. -->
    <NativeSelect
      id="tournament-region"
      name="regionId"
      value={values.regionId}
      required
    >
      <option value="" disabled>選択してください</option>
      {#each regions as region (region.id)}
        <option value={region.id}>{region.name}</option>
      {/each}
    </NativeSelect>
  </div>

  {#if regions.length === 0}
    <Message variant="danger">
      <p class="text-sm text-foreground" role="alert">
        地域が登録されていません。先に<Link href="/admin/regions">地域の管理</Link>
        から追加してください。
      </p>
    </Message>
  {/if}

  <div class="flex flex-col gap-1.5">
    <Label for="tournament-type">種別</Label>
    <NativeSelect id="tournament-type" name="type" value={values.type}>
      <option value="saikyoi">最強位</option>
      <option value="shinjinou">新人王</option>
    </NativeSelect>
  </div>

  <div class="flex flex-col gap-1.5">
    <Label for="tournament-name">大会名(任意)</Label>
    <!-- Optional: almost every tournament is just called after its region
         and type, which the API fills in when this is left blank. -->
    <Input
      id="tournament-name"
      class="w-full"
      type="text"
      name="name"
      value={values.name}
      aria-describedby="tournament-name-hint"
    />
    <p id="tournament-name-hint" class="text-sm text-muted-foreground">
      空欄にすると「地域名＋種別」(例: 東京最強位)になります
    </p>
  </div>

  <div class="flex flex-col gap-1.5">
    <Label for="tournament-capacity">定員(空欄で無制限)</Label>
    <Input
      id="tournament-capacity"
      class="w-full sm:w-48"
      type="number"
      name="capacity"
      min="1"
      value={values.capacity}
    />
  </div>

  <!-- The step only drops to a second for a stored instant that falls
       mid-minute, which the default minute step would refuse outright. -->
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="flex flex-col gap-1.5">
      <Label for="tournament-entry-opens-at">エントリー開始日時 (JST)</Label>
      <Input
        id="tournament-entry-opens-at"
        class="w-full"
        type="datetime-local"
        name="entryOpensAt"
        step={datetimeLocalStep(values.entryOpensAt)}
        value={values.entryOpensAt}
        required
      />
    </div>

    <div class="flex flex-col gap-1.5">
      <Label for="tournament-entry-closes-at">エントリー終了日時 (JST)</Label>
      <Input
        id="tournament-entry-closes-at"
        class="w-full"
        type="datetime-local"
        name="entryClosesAt"
        step={datetimeLocalStep(values.entryClosesAt)}
        value={values.entryClosesAt}
        required
      />
    </div>
  </div>

  <div class="flex flex-wrap gap-2">
    <Button type="submit">{submitLabel}</Button>
  </div>
</form>
