<script lang="ts">
  import {enhance} from '$app/forms';
  import {
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    TOURNAMENT_TYPE_LABELS,
    TournamentTypeSchema,
  } from '@regional-quiz/shared';
  import NativeSelect from '$lib/components/form/NativeSelect.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PasswordRequirements from '$lib/components/PasswordRequirements.svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();
  // Bound so `PasswordRequirements` can check them as they are typed (#177).
  let newPassword = $state('');
  let newPasswordConfirm = $state('');
  let turnstile = $state<ReturnType<typeof Turnstile>>();
</script>

<PageContainer size="narrow">
  <PageHeader title="スタッフパスワード設定" />

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  <!-- The token itself never reaches the page: `load` keeps it in an
       httpOnly cookie (`$lib/server/reset-token.ts`), which the action reads.
       Once the API has refused it, the request form is offered again. -->
  {#if data.hasToken && !form?.tokenRejected}
    <Card>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground">
          スタッフアカウントで使用するパスワードを入力してください。
        </p>

        <form method="POST" use:enhance class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <Label for="newPassword">パスワード</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autocomplete="new-password"
              minlength={PASSWORD_MIN_LENGTH}
              maxlength={PASSWORD_MAX_LENGTH}
              bind:value={newPassword}
              aria-describedby="password-requirements"
              required
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="newPasswordConfirm">パスワード(確認用)</Label>
            <Input
              id="newPasswordConfirm"
              name="newPasswordConfirm"
              type="password"
              autocomplete="new-password"
              minlength={PASSWORD_MIN_LENGTH}
              maxlength={PASSWORD_MAX_LENGTH}
              bind:value={newPasswordConfirm}
              required
            />
          </div>

          <div id="password-requirements">
            <PasswordRequirements
              password={newPassword}
              confirmation={newPasswordConfirm}
            />
          </div>

          <Button type="submit" class="w-full">パスワードを設定する</Button>
        </form>

        <!-- The page can't tell whether the link this browser opened still
             works; a staff member who got here some other way can ask for a
             new one instead. -->
        <p class="text-center text-sm">
          <Link href="/staff/password-reset?request" variant="secondary"
            >新しいリンクを申し込む</Link
          >
        </p>
      </div>
    </Card>
  {:else if form?.sent}
    <Message variant="success">
      <p role="status" class="text-sm">
        パスワード再設定用のリンクをメールで送信しました。メールをご確認ください。
      </p>
    </Message>
  {:else}
    <Card class="gap-4">
      <p class="text-sm text-muted-foreground">
        スタッフアカウントのメールアドレスと区分を入力してください。パスワード再設定用のリンクを送信します。
      </p>

      <!-- The `enhance` callback hands the challenge back after a refusal, as
           on the participant screen (see `Turnstile.svelte`). -->
      <form
        method="POST"
        class="flex flex-col gap-4"
        use:enhance={() => {
          return async ({update}) => {
            await update();
            turnstile?.reset();
          };
        }}
      >
        <div class="flex flex-col gap-1.5">
          <Label for="email">メールアドレス</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autocomplete="username"
            required
          />
        </div>

        <!-- One address may hold a 最強位 and a 新人王 account (#166), so the
             request names one the same way the login does. -->
        <div class="flex flex-col gap-1.5">
          <Label for="scope">区分</Label>
          <NativeSelect id="scope" name="scope" required>
            <option value="">選択してください</option>
            {#each TournamentTypeSchema.options as type (type)}
              <option value={type}>{TOURNAMENT_TYPE_LABELS[type]}の地域スタッフ</option>
            {/each}
            <option value="general">統括スタッフ</option>
          </NativeSelect>
        </div>

        <Turnstile bind:this={turnstile} />

        <Button type="submit" class="w-full">再設定用リンクを送信する</Button>
      </form>
    </Card>
  {/if}

  <p class="text-sm">
    <Link href="/staff/login">ログイン画面へ戻る</Link>
  </p>
</PageContainer>
