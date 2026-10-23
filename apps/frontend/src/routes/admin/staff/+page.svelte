<script lang="ts">
  import {
    TOURNAMENT_TYPE_LABELS,
    type StaffAccount,
    type StaffRole,
  } from '@regional-quiz/shared';
  import NativeSelect from '$lib/components/form/NativeSelect.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  const ROLE_LABELS: Record<StaffRole, string> = {
    general: '統括スタッフ',
    regional: '地域スタッフ',
  };

  const inviteResult = $derived(form?.intent === 'invite' ? form : null);

  /**
   * The result belonging to one account's row, if that row's button was the
   * one just pressed.
   * @param accountId The row's account.
   */
  function resendResult(accountId: string) {
    return form?.intent === 'resend' && form.accountId === accountId
      ? form
      : null;
  }

  /**
   * How an account's scope reads in the list. A `general` account covers
   * every region, so it has none to name.
   * @param account The account being listed.
   */
  function scopeLabel(account: StaffAccount): string {
    if (account.role === 'general') return '全地域';
    const region = account.regionName ?? '地域未設定';
    const type = account.tournamentType
      ? TOURNAMENT_TYPE_LABELS[account.tournamentType]
      : '種別未設定';
    return `${region} / ${type}`;
  }
</script>

<PageContainer>
  <PageHeader title="スタッフアカウントの管理" />

  <Card>
    <div class="flex flex-col gap-2">
      <h2 class="text-lg font-bold">スタッフを招待</h2>

      <p class="text-sm text-muted-foreground">
        招待するとパスワード設定用のリンクがそのアドレスに届きます。パスワードをこの
        画面で決めることはできません。
      </p>
    </div>

    {#if inviteResult?.saved}
      <Message variant="success">
        <p role="status" class="text-sm text-foreground">招待メールを送信しました</p>
      </Message>
    {/if}
    {#if inviteResult?.error}
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{inviteResult.error}</p>
      </Message>
    {/if}

    <form method="POST" action="?/invite" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label for="staff-invite-email">メールアドレス</Label>
        <Input
          id="staff-invite-email"
          class="w-full"
          name="email"
          type="email"
          required
          isError={Boolean(inviteResult?.fieldErrors.email)}
          value={inviteResult?.values.email ?? ''}
        />
        {#if inviteResult?.fieldErrors.email}
          <p role="alert" class="text-sm text-destructive">
            {inviteResult.fieldErrors.email[0]}
          </p>
        {/if}
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="staff-invite-role">権限</Label>
        <NativeSelect
          id="staff-invite-role"
          name="role"
          value={inviteResult?.values.role ?? 'regional'}
        >
          <option value="regional">地域スタッフ</option>
          <option value="general">統括スタッフ</option>
        </NativeSelect>
      </div>

      <!-- Both controls are ignored for a `general` account, which is scoped to
           no region at all; the action drops them rather than sending nulls. -->
      <div class="flex flex-col gap-1.5">
        <Label for="staff-invite-region">担当地域(地域スタッフのみ)</Label>
        <NativeSelect
          id="staff-invite-region"
          name="regionId"
          isError={Boolean(inviteResult?.fieldErrors.regionId)}
          value={inviteResult?.values.regionId ?? ''}
        >
          <option value="">選択してください</option>
          {#each data.regions as region (region.id)}
            <option value={region.id}>{region.name}</option>
          {/each}
        </NativeSelect>
        {#if inviteResult?.fieldErrors.regionId}
          <p role="alert" class="text-sm text-destructive">
            {inviteResult.fieldErrors.regionId[0]}
          </p>
        {/if}
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="staff-invite-tournament-type">担当種別(地域スタッフのみ)</Label>
        <NativeSelect
          id="staff-invite-tournament-type"
          name="tournamentType"
          value={inviteResult?.values.tournamentType ?? 'saikyoi'}
        >
          <option value="saikyoi">最強位</option>
          <option value="shinjinou">新人王</option>
        </NativeSelect>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button type="submit">招待する</Button>
      </div>
    </form>
  </Card>

  <section class="flex flex-col gap-4">
    <h2 class="text-lg font-bold">登録済みのアカウント</h2>

    {#if data.accounts.length === 0}
      <p class="text-sm text-muted-foreground">
        まだスタッフアカウントが登録されていません。
      </p>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each data.accounts as account (account.id)}
          {@const result = resendResult(account.id)}
          <li>
            <Card class="gap-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="flex min-w-0 flex-col gap-1">
                  <h3 class="break-all text-base font-bold">{account.email}</h3>
                  <p class="text-sm text-muted-foreground">
                    {ROLE_LABELS[account.role]} / {scopeLabel(account)}
                  </p>
                </div>
                <Chip
                  variant={account.passwordSet ? 'success' : 'warning'}
                  tone="soft"
                >
                  {account.passwordSet
                    ? 'パスワード設定済み'
                    : 'パスワード未設定(招待メールのリンク待ち)'}
                </Chip>
              </div>

              {#if result?.saved}
                <Message variant="success">
                  <p role="status" class="text-sm text-foreground">
                    パスワード設定メールを再送しました
                  </p>
                </Message>
              {/if}
              {#if result?.error}
                <Message variant="danger">
                  <p role="alert" class="text-sm text-foreground">{result.error}</p>
                </Message>
              {/if}

              <form method="POST" action="?/resend">
                <input type="hidden" name="id" value={account.id} />
                <Button type="submit" variant="secondary" size="small">
                  パスワード設定メールを再送
                </Button>
              </form>
            </Card>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</PageContainer>
