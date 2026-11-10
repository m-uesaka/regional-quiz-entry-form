<script lang="ts">
  import TextField from '$lib/components/form/TextField.svelte';
  import PageContainer from '$lib/components/layout/PageContainer.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/atoms/Button.svelte';
  import Card from '$lib/components/ui/atoms/Card.svelte';
  import Checkbox from '$lib/components/ui/atoms/Checkbox.svelte';
  import Label from '$lib/components/ui/atoms/Label.svelte';
  import FlashMessage from '$lib/components/ui/items/FlashMessage.svelte';
  import {
    adoptEarlyInput,
    formErrorMessage,
    textFieldProps,
  } from '$lib/remote-form';
  import type {PageProps} from './$types';
  import {createRegion, updateRegion} from './regions.remote';

  const {data}: PageProps = $props();

  const createError = $derived(
    formErrorMessage(createRegion.fields.allIssues()),
  );
</script>

<PageContainer>
  <PageHeader title="地域の管理" />

  <Card>
    <h2 class="text-lg font-bold">地域を追加</h2>

    {#if createError}
      <FlashMessage kind="error">{createError}</FlashMessage>
    {:else if createRegion.result?.saved}
      <FlashMessage kind="success">地域を追加しました</FlashMessage>
    {/if}

    <form {...createRegion} {@attach adoptEarlyInput} class="flex flex-col gap-4">
      <!-- Fixed at creation time: it is one segment of the published entry-form
           URL, so the row forms below carry no control for it. -->
      <TextField
        id="region-create-slug"
        class="w-full"
        label="slug"
        required
        errorRole="alert"
        {...textFieldProps(createRegion.fields.slug)}
      />

      <TextField
        id="region-create-name"
        class="w-full"
        label="地域名"
        required
        errorRole="alert"
        {...textFieldProps(createRegion.fields.name)}
      />

      <div class="flex items-center gap-2">
        <Checkbox
          id="region-create-dual-entry"
          {...createRegion.fields.allowsDualEntry.as('checkbox')}
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
          {@const update = updateRegion.for(region.id)}
          {@const updateError = formErrorMessage(update.fields.allIssues())}
          <li>
            <Card class="gap-4">
              <h3 class="font-mono text-base font-bold">{region.slug}</h3>

              {#if updateError}
                <FlashMessage kind="error">{updateError}</FlashMessage>
              {:else if update.result?.saved}
                <FlashMessage kind="success">保存しました</FlashMessage>
              {/if}

              <form
                {...update}
                {@attach adoptEarlyInput}
                class="flex flex-col gap-4"
              >
                <input {...update.fields.id.as('hidden', region.id)} />

                <TextField
                  id="region-{region.id}-name"
                  class="w-full"
                  label="地域名"
                  required
                  errorRole="alert"
                  {...textFieldProps(update.fields.name, region.name)}
                />

                <div class="flex items-center gap-2">
                  <Checkbox
                    id="region-{region.id}-dual-entry"
                    aria-describedby="region-{region.id}-dual-entry-hint"
                    {...update.fields.allowsDualEntry.as(
                      'checkbox',
                      region.allowsDualEntry,
                    )}
                  />
                  <Label for="region-{region.id}-dual-entry">
                    最強位と新人王の両方へのエントリーを認める
                  </Label>
                </div>
                <!-- 0045: refused while both tournaments share a question set,
                     which is changed on another screen. -->
                <p
                  id="region-{region.id}-dual-entry-hint"
                  class="text-sm text-muted-foreground"
                >
                  最強位と新人王に同じ問題セットが設定されていると、両方へのエントリーは認められません。先に大会の編集画面で、どちらかの問題セットを変更してください。
                </p>

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
