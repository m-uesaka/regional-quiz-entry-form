<script lang="ts">
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PriorityEntryNotices from '$lib/components/PriorityEntryNotices.svelte';
  import TournamentEntryForm from '$lib/components/TournamentEntryForm.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Link from '$lib/components/ui/atoms/Link.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();
</script>

<PageContainer>
  <PageHeader title={`${data.tournament.name} へのエントリー`} />

  {#if form?.submitted}
    <Message variant="success">
      {#if form.loggedIn}
        <p role="status" class="text-sm">
          エントリーを受け付けました。登録済みのメールアドレス宛に確認メールを送信したので、
          メール内のリンクを開いてエントリーを確定してください。
        </p>
      {:else}
        <!-- Worded the same whatever happened to the submission: whether it
             became an entry depends on the address, and only the owner of
             the address is told which (#117). -->
        <p role="status" class="text-sm">
          {form.email} 宛にメールを送信しました。メールの案内に従って、エントリーの手続きを進めてください。
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
      {/if}
    </Message>
  {:else}
    {#if data.priorityNotices.length > 0}
      <Message>
        <div class="flex flex-col gap-1">
          <PriorityEntryNotices notices={data.priorityNotices} />
        </div>
      </Message>
    {/if}

    {#if data.waitlistOpen}
      <Message variant="warning">
        <p class="text-sm">
          現在、定員に達しているためキャンセル待ちが発生しています。これからエントリーされる方はキャンセル待ちとなります。
        </p>
      </Message>
    {/if}

    {#if form?.error}
      <Message variant="danger">
        <p role="alert" class="text-sm">{form.error}</p>
        {#if form.loginPath}
          <p class="mt-1 text-sm">
            <Link href={form.loginPath}>ログイン画面へ</Link>
          </p>
        {/if}
      </Message>
    {/if}

    {#if !data.loggedIn}
      <Message>
        <p class="text-sm">
          既にエントリーしたことがある方・アカウントを登録済みの方は、ログインしてからエントリーしてください。
        </p>
        <p class="mt-1 text-sm">
          <Link href={data.loginPath}>ログインしてエントリーする</Link>
        </p>
      </Message>
    {/if}

    <Card>
      <!-- The form's controls own their values from their first render on, so
           they don't follow a later `data` change. SvelteKit keeps this page
           component across a navigation that changes only the route parameters,
           which would otherwise leave one tournament's answers standing in
           another tournament's form; keying on the tournament builds the form
           afresh instead. See #94. -->
      {#key data.tournament.id}
        <TournamentEntryForm
          formFieldDefs={data.formFieldDefs}
          regulations={data.regulations}
          values={form?.values}
          fieldErrors={form?.fieldErrors}
          loggedIn={data.loggedIn}
        />
      {/key}
    </Card>
  {/if}
</PageContainer>
