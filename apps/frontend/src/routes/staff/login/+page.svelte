<script lang="ts">
  import {untrack} from 'svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Input from '$lib/components/ui/atoms/Input.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  let {data, form}: PageProps = $props();

  // Seeded from the action result once, then owned by the field itself. See
  // "Form controls are bound, not rendered from an expression" in
  // `apps/frontend/README.md` for why this isn't `value={form?.email ?? ''}`.
  let email = $state(untrack(() => form?.email ?? ''));
</script>

<PageContainer size="narrow">
  <PageHeader title="スタッフログイン" />

  {#if data.passwordSet}
    <Message variant="success">
      <p role="status" class="text-sm">
        パスワードを設定しました。設定したパスワードでログインしてください。
      </p>
    </Message>
  {/if}

  {#if form?.error}
    <Message variant="danger">
      <p role="alert" class="text-sm">{form.error}</p>
    </Message>
  {/if}

  <Card>
    <!-- No `action` and no `use:enhance`: posting to the current URL keeps the
         `redirectTo` query parameter that `staffLoginPath()` attached, and a
         plain form submit means the screen works before (or without) the
         client bundle. -->
    <form method="POST" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label for="email">メールアドレス</Label>
        <Input
          id="email"
          type="email"
          name="email"
          bind:value={email}
          required
          autocomplete="username"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="password">パスワード</Label>
        <Input
          id="password"
          type="password"
          name="password"
          required
          autocomplete="current-password"
        />
      </div>
      <Button type="submit" class="w-full">ログイン</Button>
    </form>
  </Card>
</PageContainer>
