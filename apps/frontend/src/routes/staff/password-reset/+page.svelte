<script lang="ts">
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
       Once the API has refused it, there is no form left to offer. -->
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
              minlength={8}
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
              minlength={8}
              required
            />
          </div>

          <Button type="submit" class="w-full">パスワードを設定する</Button>
        </form>
      </div>
    </Card>
  {:else}
    <Message variant="warning">
      <p class="text-sm">
        このURLにはパスワード設定用のリンクが含まれていません。メールに記載されたリンクを開き直すか、管理スタッフにリンクの再発行を依頼してください。
      </p>
    </Message>
  {/if}

  <p class="text-sm">
    <Link href="/staff/login">ログイン画面へ戻る</Link>
  </p>
</PageContainer>
