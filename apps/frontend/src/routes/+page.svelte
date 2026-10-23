<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
</script>

<PageContainer>
  <PageHeader
    title="地域クイズ最強位・新人王 エントリー"
    description="エントリーは、各地域のスタッフから案内されるエントリーフォームの URL から行ってください。"
  />

  <div class="grid gap-4 sm:grid-cols-2">
    <Card class="justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">参加者の方</h2>
        <p class="text-sm text-muted-foreground">
          エントリー内容の確認・編集・キャンセルはこちらから。
        </p>
      </div>
      <a
        href="/mypage"
        class={buttonVariants({variant: 'primary', tone: 'solid', size: 'medium'})}
      >
        マイページ
      </a>
    </Card>

    <Card class="justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">スタッフの方</h2>
        <p class="text-sm text-muted-foreground">
          大会の設定やエントリーの管理はこちらから。
        </p>
      </div>
      <a
        href="/staff/login"
        class={buttonVariants({variant: 'secondary', tone: 'solid', size: 'medium'})}
      >
        スタッフログイン
      </a>
    </Card>
  </div>
</PageContainer>
