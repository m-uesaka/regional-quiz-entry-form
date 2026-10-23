<script lang="ts">
  import {untrack} from 'svelte';
  import {enhance} from '$app/forms';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();

  // Seeded from the action result once, then owned by the field itself. See
  // "Form controls are bound, not rendered from an expression" in
  // `apps/frontend/README.md` for why this isn't `value={form?.email ?? ''}`.
  let email = $state(untrack(() => form?.email ?? ''));
</script>

<PageContainer size="narrow">
  <PageHeader title="マイページ ログイン" />

  {#if data.passwordReset}
    <Message variant="success">
      <p role="status" class="text-sm">
        パスワードを再設定しました。新しいパスワードでログインしてください。
      </p>
    </Message>
  {/if}

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  <Card>
    <form method="POST" class="flex flex-col gap-4" use:enhance>
      <div class="flex flex-col gap-1.5">
        <Label for="email">メールアドレス</Label>
        <Input
          id="email"
          name="email"
          type="email"
          bind:value={email}
          autocomplete="email"
          required
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="password">パスワード</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>

      <Button type="submit" variant="primary" tone="solid" class="w-full">
        ログイン
      </Button>
    </form>
  </Card>

  <div class="text-center text-sm">
    <Link href="/password-reset">パスワードを忘れた方はこちら</Link>
  </div>
</PageContainer>
