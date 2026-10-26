<!--
@component
Tells someone choosing a password, while they type, whether it will be
accepted (#177): at least `PASSWORD_MIN_LENGTH` characters, not one of the
passwords everyone else uses, and -- given the confirmation field's value --
typed the same twice. The rules themselves stay the server's to enforce
(`PasswordSchema`); this only says in advance what it will say.

The common-password list is ~30 KB, so it isn't in the page's bundle: it is
loaded with a dynamic `import()` once this component is on a page in a
browser, as a chunk of its own. Until then -- and in the server-rendered
HTML, or with JS off -- only the sentence describing the rules is shown.
-->
<script module lang="ts">
  type CommonPasswordCheck = (password: string) => boolean;

  // One load shared by every instance on the page. A failed load (a deploy
  // that replaced the chunk, a dropped connection) is forgotten, so the next
  // instance to ask tries again rather than inheriting the failure.
  let pendingCheck: Promise<CommonPasswordCheck> | undefined;

  function loadCommonPasswordCheck(): Promise<CommonPasswordCheck> {
    pendingCheck ??= import('@regional-quiz/shared/common-passwords').then(
      module => module.isCommonPassword,
      (error: unknown) => {
        pendingCheck = undefined;
        throw error;
      },
    );
    return pendingCheck;
  }
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import {PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH} from '@regional-quiz/shared';

  interface Props {
    /** The password as typed so far. */
    password: string;
    /** The confirmation field's value, when the form has one. */
    confirmation?: string;
    /**
     * Whether the rules only apply to a new account. True on the entry form,
     * where the same field is how a registered participant proves the
     * password they already have, which may predate the rules -- so a
     * common password there is a caution, not a failure.
     */
    newAccountOnly?: boolean;
  }

  let {password, confirmation, newAccountOnly = false}: Props = $props();

  /**
   * How a rule stands: met, broken, broken but only for a new account
   * (`warn`), or not decided yet (`pending`, shown neutrally).
   */
  type RuleStatus = 'ok' | 'fail' | 'warn' | 'pending';

  // `loading` until the list arrives; `unavailable` if it never does, in
  // which case the server's answer is the only one there will be.
  let commonPasswordCheck = $state<
    CommonPasswordCheck | 'loading' | 'unavailable'
  >('loading');
  $effect(() => {
    loadCommonPasswordCheck().then(
      check => {
        commonPasswordCheck = check;
      },
      () => {
        commonPasswordCheck = 'unavailable';
      },
    );
  });

  // No running character count: it would change on every keystroke, and
  // `password.length` counts UTF-16 code units -- what the server checks,
  // but not what anyone typing an emoji would call a character.
  const lengthStatus = $derived<RuleStatus>(
    password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH
      ? 'ok'
      : 'fail',
  );
  const commonStatus = $derived.by<RuleStatus>(() => {
    if (typeof commonPasswordCheck !== 'function') {
      return 'pending';
    }
    if (!commonPasswordCheck(password)) {
      return 'ok';
    }
    return newAccountOnly ? 'warn' : 'fail';
  });
  // Nothing to say while the confirmation is empty, or still on its way to
  // matching (a prefix of the password): only a finished mismatch is one.
  const matchStatus = $derived.by<RuleStatus | null>(() => {
    if (!confirmation) {
      return null;
    }
    if (confirmation === password) {
      return 'ok';
    }
    return password.startsWith(confirmation) ? null : 'fail';
  });

  const commonLabel = $derived(
    {
      ok: 'よく使われているパスワードではない',
      fail: 'よく使われているパスワードのため使えません',
      warn: 'よく使われているパスワードのため、新規登録では使えません(登録済みのアカウントのパスワードであれば、そのまま使えます)',
      pending:
        commonPasswordCheck === 'unavailable'
          ? 'よく使われているパスワードかどうかは、送信時に確認されます'
          : 'よく使われているパスワードかどうかを確認しています',
    }[commonStatus],
  );

  /** What a screen reader hears before each rule, for the icon it can't see. */
  const STATUS_PREFIXES: Record<RuleStatus, string> = {
    ok: '満たしています:',
    fail: '満たしていません:',
    warn: '注意:',
    pending: '',
  };
</script>

{#snippet rule(status: RuleStatus, label: string)}
  <li
    class={[
      'flex items-start gap-1.5',
      status === 'ok' && 'text-success',
      status === 'fail' && 'text-destructive',
      status === 'warn' && 'text-warning',
      status === 'pending' && 'text-muted-foreground',
    ]}
  >
    {#if status === 'ok'}
      <Check class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    {:else if status === 'fail'}
      <X class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    {:else if status === 'warn'}
      <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    {:else}
      <span class="size-4 shrink-0" aria-hidden="true"></span>
    {/if}
    <span>
      {#if STATUS_PREFIXES[status]}<span class="sr-only"
          >{STATUS_PREFIXES[status]}</span
        >{/if}{label}
    </span>
  </li>
{/snippet}

<div class="flex flex-col gap-1 text-sm">
  <p class="text-muted-foreground">
    パスワードは{PASSWORD_MIN_LENGTH}文字以上で設定してください。「password」「testtest」「12345678」のような、よく使われているパスワードは使えません。
    {#if newAccountOnly}
      (登録済みのアカウントでエントリーする場合は、登録済みのパスワードをそのまま入力してください。)
    {/if}
  </p>
  <!-- The live region is always in the page and only its contents come and
       go: most screen readers don't announce a region that arrives already
       filled. Its text changes only when a rule's standing does, so it is
       announced then rather than on every keystroke. The rules appear once
       something is typed, so an empty field isn't greeted with crosses. -->
  <ul aria-live="polite" class="flex flex-col gap-0.5">
    {#if password !== ''}
      {@render rule(
        lengthStatus,
        password.length > PASSWORD_MAX_LENGTH
          ? `${PASSWORD_MAX_LENGTH}文字以内`
          : `${PASSWORD_MIN_LENGTH}文字以上`,
      )}
      {@render rule(commonStatus, commonLabel)}
      {#if matchStatus !== null}
        {@render rule(
          matchStatus,
          matchStatus === 'ok'
            ? '確認用と一致している'
            : '確認用と一致していません',
        )}
      {/if}
    {/if}
  </ul>
</div>
