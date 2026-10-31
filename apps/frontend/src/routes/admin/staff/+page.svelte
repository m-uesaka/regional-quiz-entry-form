<script lang="ts">
  import {
    TOURNAMENT_TYPE_LABELS,
    type StaffAccount,
    type StaffRole,
  } from '@regional-quiz/shared';
  import FieldError from '$lib/components/form/FieldError.svelte';
  import NativeSelect from '$lib/components/form/NativeSelect.svelte';
  import TextField from '$lib/components/form/TextField.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Chip from '$lib/components/ui/atoms/Chip.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {RowIntent} from './+page.server';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  const ROLE_LABELS: Record<StaffRole, string> = {
    general: '統括スタッフ',
    regional: '地域スタッフ',
  };

  const inviteResult = $derived(form?.intent === 'invite' ? form : null);

  /**
   * The result belonging to one of an account's row buttons, if that button
   * was the one just pressed.
   * @param intent Which of the row's buttons.
   * @param accountId The row's account.
   */
  function rowResult(intent: RowIntent, accountId: string) {
    return form?.intent === intent && form.accountId === accountId
      ? form
      : null;
  }

  /**
   * Asks before a revocation goes out, since it can't be undone and, on the
   * caller's own row, logs this very screen out along with every other
   * device. Cancelling keeps the form from submitting.
   * @param event The revoke form's submit event.
   * @param email The account the form is for.
   * @param isSelf Whether that account is the caller's own.
   */
  function confirmRevoke(event: SubmitEvent, email: string, isSelf: boolean) {
    const message = isSelf
      ? 'あなた自身のセッションを無効化します。この画面を含むすべての端末からログアウトします。よろしいですか?'
      : `${email} のセッションを無効化します。よろしいですか?`;
    if (!confirm(message)) event.preventDefault();
  }

  /**
   * Asks before an account is disabled, since its owner is logged out
   * everywhere and can't log back in until someone enables it again.
   * Cancelling keeps the form from submitting.
   * @param event The disable form's submit event.
   * @param email The account the form is for.
   */
  function confirmDisable(event: SubmitEvent, email: string) {
    const message = `${email} を無効化します。このアカウントはすべての端末でログアウトされ、有効化するまでログインできなくなります。よろしいですか?`;
    if (!confirm(message)) event.preventDefault();
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
      <TextField
        id="staff-invite-email"
        class="w-full"
        name="email"
        label="メールアドレス"
        type="email"
        required
        error={inviteResult?.fieldErrors.email?.[0]}
        errorRole="alert"
        value={inviteResult?.values.email ?? ''}
      />

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
        <FieldError
          error={inviteResult?.fieldErrors.regionId?.[0]}
          role="alert"
        />
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
          {@const result = rowResult('resend', account.id)}
          {@const revokeResult = rowResult('revoke', account.id)}
          {@const disableResult = rowResult('disable', account.id)}
          {@const enableResult = rowResult('enable', account.id)}
          {@const isSelf = account.id === data.staff.sub}
          {@const disabled = account.disabledAt !== null}
          <li>
            <Card class="gap-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="flex min-w-0 flex-col gap-1">
                  <h3 class="break-all text-base font-bold">{account.email}</h3>
                  <p class="text-sm text-muted-foreground">
                    {ROLE_LABELS[account.role]} / {scopeLabel(account)}
                  </p>
                </div>
                {#if disabled}
                  <Chip variant="danger" tone="soft">無効化済み</Chip>
                {:else}
                  <Chip
                    variant={account.passwordSet ? 'success' : 'warning'}
                    tone="soft"
                  >
                    {account.passwordSet
                      ? 'パスワード設定済み'
                      : 'パスワード未設定(招待メールのリンク待ち)'}
                  </Chip>
                {/if}
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

              {#if revokeResult?.saved}
                <Message variant="success">
                  <p role="status" class="text-sm text-foreground">
                    このアカウントのログイン中のセッションをすべて無効化しました
                  </p>
                </Message>
              {/if}
              {#if revokeResult?.error}
                <Message variant="danger">
                  <p role="alert" class="text-sm text-foreground">
                    {revokeResult.error}
                  </p>
                </Message>
              {/if}

              {#if disableResult?.saved}
                <Message variant="success">
                  <p role="status" class="text-sm text-foreground">
                    このアカウントを無効化しました
                  </p>
                </Message>
              {/if}
              {#if disableResult?.error}
                <Message variant="danger">
                  <p role="alert" class="text-sm text-foreground">
                    {disableResult.error}
                  </p>
                </Message>
              {/if}

              {#if enableResult?.saved}
                <Message variant="success">
                  <p role="status" class="text-sm text-foreground">
                    このアカウントを有効化しました
                  </p>
                </Message>
              {/if}
              {#if enableResult?.error}
                <Message variant="danger">
                  <p role="alert" class="text-sm text-foreground">
                    {enableResult.error}
                  </p>
                </Message>
              {/if}

              {#if disabled}
                <!-- A disabled account has no session to cut and can't be
                     sent a link, so enabling it is the only thing left. -->
                <div class="flex flex-wrap gap-2">
                  <form method="POST" action="?/enable">
                    <input type="hidden" name="id" value={account.id} />
                    <Button type="submit" variant="secondary" size="small">
                      有効化
                    </Button>
                  </form>
                </div>
                <p class="text-xs text-muted-foreground">
                  無効化されたアカウントはログインできません。有効化すると、無効化前のパスワードで再びログインできます。
                </p>
              {:else}
                <div class="flex flex-wrap gap-2">
                  <form method="POST" action="?/resend">
                    <input type="hidden" name="id" value={account.id} />
                    <Button type="submit" variant="secondary" size="small">
                      パスワード設定メールを再送
                    </Button>
                  </form>

                  <!-- Ends every session the account has open, e.g. on a lost
                       device. The password stays as it is, so whoever knows it
                       can log straight back in: this doesn't lock anyone out. -->
                  <form
                    method="POST"
                    action="?/revoke"
                    onsubmit={event => confirmRevoke(event, account.email, isSelf)}
                  >
                    <input type="hidden" name="id" value={account.id} />
                    <Button type="submit" variant="danger" tone="ghost" size="small">
                      セッションを無効化
                    </Button>
                  </form>

                  <!-- Not offered on the caller's own row: the API refuses it,
                       since a general staff member who locked themselves out
                       could only be let back in by another one. -->
                  {#if !isSelf}
                    <form
                      method="POST"
                      action="?/disable"
                      onsubmit={event => confirmDisable(event, account.email)}
                    >
                      <input type="hidden" name="id" value={account.id} />
                      <Button type="submit" variant="danger" size="small">
                        アカウントを無効化
                      </Button>
                    </form>
                  {/if}
                </div>
                <p class="text-xs text-muted-foreground">
                  {isSelf
                    ? 'セッションを無効化すると、この画面を含むすべての端末からログアウトします。'
                    : 'セッションを無効化すると、このアカウントはすべての端末でログアウトされます。パスワードは変わらないため、パスワードを知っていれば再びログインできます。退任などでログインさせたくない場合は、アカウントを無効化してください。'}
                </p>
              {/if}
            </Card>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</PageContainer>
