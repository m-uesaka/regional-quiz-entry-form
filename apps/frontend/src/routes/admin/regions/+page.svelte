<script lang="ts">
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

<h1>地域の管理</h1>

<h2>地域を追加</h2>

{#if createResult?.saved}
  <p role="status">地域を追加しました</p>
{/if}
{#if createResult?.error}
  <p role="alert">{createResult.error}</p>
{/if}

<form method="POST" action="?/create">
  <label>
    slug
    <!-- Fixed at creation time: it is one segment of the published entry-form
         URL, so the row forms below carry no control for it. -->
    <input
      name="slug"
      type="text"
      required
      value={createResult?.values.slug ?? ''}
    />
  </label>
  {#if createResult?.fieldErrors.slug}
    <p role="alert">{createResult.fieldErrors.slug[0]}</p>
  {/if}

  <label>
    地域名
    <input
      name="name"
      type="text"
      required
      value={createResult?.values.name ?? ''}
    />
  </label>
  {#if createResult?.fieldErrors.name}
    <p role="alert">{createResult.fieldErrors.name[0]}</p>
  {/if}

  <label>
    <input
      name="allowsDualEntry"
      type="checkbox"
      checked={createResult?.values.allowsDualEntry ?? false}
    />
    最強位と新人王の両方へのエントリーを認める
  </label>

  <button type="submit">追加</button>
</form>

<h2>登録済みの地域</h2>

{#if data.regions.length === 0}
  <p>まだ地域が登録されていません。</p>
{:else}
  <ul>
    {#each data.regions as region (region.id)}
      {@const result = updateResult(region.id)}
      <li>
        <h3>{region.slug}</h3>

        {#if result?.saved}
          <p role="status">保存しました</p>
        {/if}
        {#if result?.error}
          <p role="alert">{result.error}</p>
        {/if}

        <form method="POST" action="?/update">
          <input type="hidden" name="id" value={region.id} />

          <label>
            地域名
            <input
              name="name"
              type="text"
              required
              value={result?.values.name ?? region.name}
            />
          </label>
          {#if result?.fieldErrors.name}
            <p role="alert">{result.fieldErrors.name[0]}</p>
          {/if}

          <label>
            <input
              name="allowsDualEntry"
              type="checkbox"
              checked={result?.values.allowsDualEntry ?? region.allowsDualEntry}
            />
            最強位と新人王の両方へのエントリーを認める
          </label>

          <button type="submit">保存</button>
        </form>
      </li>
    {/each}
  </ul>
{/if}
