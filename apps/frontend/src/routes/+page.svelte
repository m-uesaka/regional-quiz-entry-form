<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import {buttonVariants} from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
</script>

<PageContainer>
  <PageHeader
    title="地域クイズ最強位・新人王 エントリー"
    description="エントリーは、エントリーポータルにある各地域のエントリーフォームから行ってください。"
  />

  <div class="grid gap-4 md:grid-cols-3">
    <Card class="justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">参加者の方</h2>
        <p class="text-sm text-muted-foreground">
          エントリーはエントリーポータルから。エントリー内容の確認・編集・キャンセルはマイページから。
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <a
          href="/portal"
          class={buttonVariants({variant: 'primary', tone: 'solid', size: 'medium'})}
        >
          エントリーポータル
        </a>
        <a
          href="/mypage"
          class={buttonVariants({variant: 'secondary', tone: 'solid', size: 'medium'})}
        >
          マイページ
        </a>
      </div>
    </Card>

    <Card class="justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">エントリーリスト</h2>
        <p class="text-sm text-muted-foreground">
          各大会にエントリーした方の一覧はこちらから。
        </p>
      </div>
      <a
        href="/entry-lists"
        class={buttonVariants({variant: 'secondary', tone: 'solid', size: 'medium'})}
      >
        エントリーリスト一覧
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
