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
<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
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
     * password they already have, which may predate the rules.
     */
    newAccountOnly?: boolean;
  }

  let {password, confirmation, newAccountOnly = false}: Props = $props();

  let isCommonPassword = $state<((password: string) => boolean) | null>(null);
  $effect(() => {
    let cancelled = false;
    void import('@regional-quiz/shared/common-passwords').then(module => {
      if (!cancelled) {
        isCommonPassword = module.isCommonPassword;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const lengthOk = $derived(
    password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH,
  );
  // `null` while the list is still loading: neither a tick nor a cross.
  const notCommon = $derived(
    isCommonPassword === null ? null : !isCommonPassword(password),
  );
  const matches = $derived(
    confirmation === undefined || confirmation === ''
      ? null
      : confirmation === password,
  );
</script>

{#snippet rule(ok: boolean | null, label: string)}
  <li
    class={[
      'flex items-center gap-1.5',
      ok === true && 'text-success',
      ok === false && 'text-destructive',
      ok === null && 'text-muted-foreground',
    ]}
  >
    {#if ok === true}
      <Check class="size-4 shrink-0" aria-hidden="true" />
      <span class="sr-only">満たしています:</span>
    {:else if ok === false}
      <X class="size-4 shrink-0" aria-hidden="true" />
      <span class="sr-only">満たしていません:</span>
    {:else}
      <span class="size-4 shrink-0" aria-hidden="true"></span>
    {/if}
    {label}
  </li>
{/snippet}

<div class="flex flex-col gap-1 text-sm">
  <p class="text-muted-foreground">
    パスワードは{PASSWORD_MIN_LENGTH}文字以上で設定してください。「password」「testtest」「12345678」のような、よく使われているパスワードは使えません。
    {#if newAccountOnly}
      (登録済みのアカウントでエントリーする場合は、登録済みのパスワードをそのまま入力してください。)
    {/if}
  </p>
  <!-- Shown once something is typed, so an empty field isn't greeted with
       a row of crosses. Announced politely, so a screen reader hears a rule
       change without being interrupted on every keystroke. -->
  {#if password !== ''}
    <ul aria-live="polite" class="flex flex-col gap-0.5">
      {@render rule(
        lengthOk,
        password.length > PASSWORD_MAX_LENGTH
          ? `${PASSWORD_MAX_LENGTH}文字以内`
          : `${PASSWORD_MIN_LENGTH}文字以上(現在${password.length}文字)`,
      )}
      {@render rule(
        notCommon,
        notCommon === null
          ? 'よく使われているパスワードかどうかを確認しています'
          : notCommon
            ? 'よく使われているパスワードではない'
            : newAccountOnly
              ? 'よく使われているパスワードのため、新規登録では使えません'
              : 'よく使われているパスワードのため使えません',
      )}
      {#if matches !== null}
        {@render rule(
          matches,
          matches ? '確認用と一致している' : '確認用と一致していません',
        )}
      {/if}
    </ul>
  {/if}
</div>
