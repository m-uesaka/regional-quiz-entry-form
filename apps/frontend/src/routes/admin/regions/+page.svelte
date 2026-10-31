<script lang="ts">
  import TextField from '$lib/components/form/TextField.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Checkbox from '$lib/components/ui/atoms/Checkbox.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import Message from '$lib/components/ui/items/Message.svelte';
  import type {PageProps} from './$types';

  const {data, form}: PageProps = $props();

  // The create form's own result, if the last submission came from it. The
  // row forms share the same `form` prop, so each half checks the intent
  // before showing anything.
  const createResult = $derived(form?.intent === 'create' ? form : null);

  /**
   * The result belonging to one region's row, if that row was the one just
   * submitted.
   * @param regionId The row's region.
   */
  function updateResult(regionId: string) {
    return form?.intent === 'update' && form.regionId === regionId
      ? form
      : null;
  }
</script>

<PageContainer>
  <PageHeader title="地域の管理" />

  <Card>
    <h2 class="text-lg font-bold">地域を追加</h2>

    {#if createResult?.saved}
      <Message variant="success">
        <p role="status" class="text-sm text-foreground">地域を追加しました</p>
      </Message>
    {/if}
    {#if createResult?.error}
      <Message variant="danger">
        <p role="alert" class="text-sm text-foreground">{createResult.error}</p>
      </Message>
    {/if}

    <form method="POST" action="?/create" class="flex flex-col gap-4">
      <!-- Fixed at creation time: it is one segment of the published entry-form
           URL, so the row forms below carry no control for it. -->
      <TextField
        id="region-create-slug"
        class="w-full"
        name="slug"
        label="slug"
        type="text"
        required
        error={createResult?.fieldErrors.slug?.[0]}
        errorRole="alert"
        value={createResult?.values.slug ?? ''}
      />

      <TextField
        id="region-create-name"
        class="w-full"
        name="name"
        label="地域名"
        type="text"
        required
        error={createResult?.fieldErrors.name?.[0]}
        errorRole="alert"
        value={createResult?.values.name ?? ''}
      />

      <div class="flex items-center gap-2">
        <Checkbox
          id="region-create-dual-entry"
          name="allowsDualEntry"
          checked={createResult?.values.allowsDualEntry ?? false}
        />
        <Label for="region-create-dual-entry">
          最強位と新人王の両方へのエントリーを認める
        </Label>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button type="submit">追加</Button>
      </div>
    </form>
  </Card>

  <section class="flex flex-col gap-4">
    <h2 class="text-lg font-bold">登録済みの地域</h2>

    {#if data.regions.length === 0}
      <p class="text-sm text-muted-foreground">
        まだ地域が登録されていません。
      </p>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each data.regions as region (region.id)}
          {@const result = updateResult(region.id)}
          <li>
            <Card class="gap-4">
              <h3 class="font-mono text-base font-bold">{region.slug}</h3>

              {#if result?.saved}
                <Message variant="success">
                  <p role="status" class="text-sm text-foreground">保存しました</p>
                </Message>
              {/if}
              {#if result?.error}
                <Message variant="danger">
                  <p role="alert" class="text-sm text-foreground">{result.error}</p>
                </Message>
              {/if}

              <form method="POST" action="?/update" class="flex flex-col gap-4">
                <input type="hidden" name="id" value={region.id} />

                <TextField
                  id="region-{region.id}-name"
                  class="w-full"
                  name="name"
                  label="地域名"
                  type="text"
                  required
                  error={result?.fieldErrors.name?.[0]}
                  errorRole="alert"
                  value={result?.values.name ?? region.name}
                />

                <div class="flex items-center gap-2">
                  <Checkbox
                    id="region-{region.id}-dual-entry"
                    name="allowsDualEntry"
                    checked={result?.values.allowsDualEntry ??
                      region.allowsDualEntry}
                  />
                  <Label for="region-{region.id}-dual-entry">
                    最強位と新人王の両方へのエントリーを認める
                  </Label>
                </div>

                <div class="flex flex-wrap gap-2">
                  <Button type="submit">保存</Button>
                </div>
              </form>
            </Card>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</PageContainer>
