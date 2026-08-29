<script lang="ts">
  import {
    TOURNAMENT_TYPE_LABELS,
    type StaffAccount,
    type StaffRole,
  } from '@regional-quiz/shared';
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

<h1>スタッフアカウントの管理</h1>

<h2>スタッフを招待</h2>

<p>
  招待するとパスワード設定用のリンクがそのアドレスに届きます。パスワードをこの
  画面で決めることはできません。
</p>

{#if inviteResult?.saved}
  <p role="status">招待メールを送信しました</p>
{/if}
{#if inviteResult?.error}
  <p role="alert">{inviteResult.error}</p>
{/if}

<form method="POST" action="?/invite">
  <label>
    メールアドレス
    <input
      name="email"
      type="email"
      required
      value={inviteResult?.values.email ?? ''}
    />
  </label>
  {#if inviteResult?.fieldErrors.email}
    <p role="alert">{inviteResult.fieldErrors.email[0]}</p>
  {/if}

  <label>
    権限
    <select name="role" value={inviteResult?.values.role ?? 'regional'}>
      <option value="regional">地域スタッフ</option>
      <option value="general">統括スタッフ</option>
    </select>
  </label>

  <!-- Both controls are ignored for a `general` account, which is scoped to
       no region at all; the action drops them rather than sending nulls. -->
  <label>
    担当地域(地域スタッフのみ)
    <select name="regionId" value={inviteResult?.values.regionId ?? ''}>
      <option value="">選択してください</option>
      {#each data.regions as region (region.id)}
        <option value={region.id}>{region.name}</option>
      {/each}
    </select>
  </label>
  {#if inviteResult?.fieldErrors.regionId}
    <p role="alert">{inviteResult.fieldErrors.regionId[0]}</p>
  {/if}

  <label>
    担当種別(地域スタッフのみ)
    <select
      name="tournamentType"
      value={inviteResult?.values.tournamentType ?? 'saikyoi'}
    >
      <option value="saikyoi">最強位</option>
      <option value="shinjinou">新人王</option>
    </select>
  </label>

  <button type="submit">招待する</button>
</form>

<h2>登録済みのアカウント</h2>

{#if data.accounts.length === 0}
  <p>まだスタッフアカウントが登録されていません。</p>
{:else}
  <ul>
    {#each data.accounts as account (account.id)}
      {@const result = resendResult(account.id)}
      <li>
        <h3>{account.email}</h3>
        <p>{ROLE_LABELS[account.role]} / {scopeLabel(account)}</p>
        <p>
          {account.passwordSet
            ? 'パスワード設定済み'
            : 'パスワード未設定(招待メールのリンク待ち)'}
        </p>

        {#if result?.saved}
          <p role="status">パスワード設定メールを再送しました</p>
        {/if}
        {#if result?.error}
          <p role="alert">{result.error}</p>
        {/if}

        <form method="POST" action="?/resend">
          <input type="hidden" name="id" value={account.id} />
          <button type="submit">
            パスワード設定メールを再送
          </button>
        </form>
      </li>
    {/each}
  </ul>
{/if}
