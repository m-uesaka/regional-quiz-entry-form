<script lang="ts">
  import TournamentEditor from '$lib/components/TournamentEditor.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Checkbox from '$lib/components/ui/atoms/Checkbox.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import {RESET_CONFIRMATION_WORD} from '$lib/tournament-form';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  // `form` is whichever action answered last; each section reads only its
  // own action's result.
  const updateResult = $derived(form?.saved === undefined ? null : form);
  const deleteError = $derived(form?.deleteError ?? null);
  const resetResult = $derived(form?.reset ?? null);
  const resetMessage = $derived.by(() => {
    if (!resetResult) {
      return null;
    }
    const lines = [`エントリーを ${resetResult.deletedEntryCount} 件削除しました。`];
    if (resetResult.deletedParticipantCount > 0) {
      lines.push(
        `参加者アカウントを ${resetResult.deletedParticipantCount} 件削除しました。`,
      );
    }
    if (resetResult.keptParticipantCount > 0) {
      lines.push(
        `他の大会にエントリーが残っている ${resetResult.keptParticipantCount} 件の参加者アカウントは残しました。`,
      );
    }
    return lines.join('');
  });
  const resetError = $derived(form?.resetError ?? null);
</script>

<PageContainer>
  <PageHeader title="大会を編集" />

  <!-- The import panel's own draft is seeded on its first render and stops
       following `data` after it. SvelteKit keeps this page component across a
       navigation that changes only the route parameters, which would otherwise
       leave one tournament's sheet filed under the next one's id. Keying on
       the tournament builds it afresh instead. See #98. -->
  {#key data.tournament.id}
    <TournamentEditor
      tournament={data.tournament}
      customName={data.customName}
      formDefinitionYaml={data.formDefinitionYaml}
      regions={data.regions}
      result={updateResult}
    />
  {/key}

  <Card class="gap-3">
    <h2 class="text-lg font-bold">レギュレーション</h2>

    <p class="text-sm">
      <Link href="/admin/tournaments/{data.tournament.id}/regulations">
        レギュレーションを管理
      </Link>
    </p>
  </Card>
  <Card class="gap-3">
    <h2 class="text-lg font-bold">参加者データをリセット</h2>

    <p class="text-sm">
      この大会のエントリーを、キャンセル済みのものも含めてすべて削除します。大会の設定・レギュレーション・フォーム定義・一斉メールの記録は残ります。削除したエントリーは元に戻せません。
    </p>

    {#if resetMessage}
      <Message variant="success">
        <p role="status" class="text-sm text-foreground">{resetMessage}</p>
      </Message>
    {/if}
    {#if resetError}
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{resetError}</p>
      </Message>
    {/if}

    <!-- A form action like the delete above. Neither choice is preselected,
         so whether the accounts go too is always picked on purpose, and the
         button waits for a typed word rather than a tick (see
         `RESET_CONFIRMATION_WORD`). -->
    <form method="POST" action="?/reset" class="flex flex-col gap-3">
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm font-bold">参加者アカウント</legend>
        <label class="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            class="size-4 cursor-pointer accent-primary"
            name="participants"
            value="keep"
            required
          />
          参加者アカウントは残す
        </label>
        <label class="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            class="size-4 cursor-pointer accent-primary"
            name="participants"
            value="delete"
            required
          />
          参加者アカウントも削除する
        </label>
        <p class="text-xs text-muted-foreground">
          削除する場合も、他の大会にエントリーが残っている参加者のアカウントは残します。
        </p>
      </fieldset>
      <div class="flex flex-col gap-1">
        <Label for="tournament-reset-confirmation">
          確認のため「{RESET_CONFIRMATION_WORD}」と入力してください
        </Label>
        <Input
          id="tournament-reset-confirmation"
          name="confirmation"
          autocomplete="off"
          required
          pattern={RESET_CONFIRMATION_WORD}
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" variant="danger">参加者データをリセット</Button>
      </div>
    </form>
  </Card>
  <Card class="gap-3">
    <h2 class="text-lg font-bold">大会を削除</h2>

    <p class="text-sm">
      間違えて作成した大会を削除します。レギュレーション・フォーム定義・一斉メールの記録も一緒に削除され、元に戻せません。エントリーがある大会は削除できません。
    </p>

    {#if deleteError}
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{deleteError}</p>
      </Message>
    {/if}

    <!-- A form action, like the update above, and behind a required tick
         rather than a `confirm()` dialog, so it works without JavaScript and
         cannot go off on a single stray click. -->
    <form method="POST" action="?/delete" class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <Checkbox id="tournament-delete-confirm" name="confirm" required />
        <Label for="tournament-delete-confirm">この大会を削除する</Label>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" variant="danger">大会を削除</Button>
      </div>
    </form>
  </Card>
</PageContainer>
