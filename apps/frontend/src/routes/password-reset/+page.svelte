<script lang="ts">
  import {enhance} from '$app/forms';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();
  let turnstile = $state<ReturnType<typeof Turnstile>>();
</script>

<PageContainer size="narrow">
  <PageHeader title="パスワード再設定" />

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  <!-- The token itself never reaches the page: `load` keeps it in an
       httpOnly cookie (`$lib/server/reset-token.ts`), which the action reads.
       Once the API has refused it, the request form is offered again. -->
  {#if data.hasToken && !form?.tokenRejected}
    <Card class="gap-4">
      <p class="text-sm text-muted-foreground">
        新しいパスワードを入力してください。
      </p>

      <form method="POST" class="flex flex-col gap-4" use:enhance>
        <div class="flex flex-col gap-1.5">
          <Label for="newPassword">新しいパスワード</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            minlength={8}
            required
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="newPasswordConfirm">新しいパスワード(確認用)</Label>
          <Input
            id="newPasswordConfirm"
            name="newPasswordConfirm"
            type="password"
            autocomplete="new-password"
            minlength={8}
            required
          />
        </div>

        <Button type="submit" variant="primary" tone="solid" class="w-full">
          パスワードを再設定する
        </Button>
      </form>
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
        ご登録のメールアドレスを入力してください。パスワード再設定用のリンクを送信します。
      </p>

      <!-- The `enhance` callback is only here to hand the challenge back: a
           refusal is reported with `fail()`, which re-renders this form in
           place with the token it already spent still in it, so the retry the
           message invites would fail the challenge rather than whatever it was
           actually refused for. See `Turnstile.svelte`. -->
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
            autocomplete="email"
            required
          />
        </div>

        <!-- Only this half of the flow is behind the challenge: it mails a link
             to whatever address is typed in, while the form above is reached
             only with a token that was already mailed to the account's own
             address (#116). -->
        <Turnstile bind:this={turnstile} />

        <Button type="submit" variant="primary" tone="solid" class="w-full">
          再設定用リンクを送信する
        </Button>
      </form>
    </Card>
  {/if}

  <div class="text-center text-sm">
    <Link href="/mypage/login" variant="secondary">ログイン画面へ戻る</Link>
  </div>
</PageContainer>
