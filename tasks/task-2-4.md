[← tasks.md](../tasks.md) / Phase 2: 大会・フォーム定義管理(統括スタッフ)

### Task 2-4: 大会作成・フォーム定義管理画面

#### 実装・更新内容

* 統括スタッフ向けに、大会の作成・編集フォームと、スプレッドシート URL 入力 → YAML プレビュー → 保存の一連の UI を `apps/frontend/src/routes/admin/tournaments/` に実装する。
* Task 0-4 の `createApiClient()` を使い、Task 2-1〜2-3 の API を呼び出す。

#### コードスニペット

`apps/frontend/src/routes/admin/tournaments/new/+page.svelte`

```svelte
<script lang="ts">
  import { createApiClient } from '$lib/api';

  let spreadsheetId = $state('');
  let tournamentSlug = $state('');
  let previewYaml = $state<string | null>(null);

  const api = createApiClient();

  async function handlePreview() {
    const res = await api['sheet-import'].preview.$post({
      json: { spreadsheetId, tournamentSlug },
    });
    const body = await res.json();
    previewYaml = body.yaml;
  }
</script>

<form onsubmit={(e) => { e.preventDefault(); handlePreview(); }}>
  <input bind:value={tournamentSlug} placeholder="大会スラッグ" />
  <input bind:value={spreadsheetId} placeholder="スプレッドシートID" />
  <button type="submit">YAMLプレビュー</button>
</form>

{#if previewYaml}
  <pre>{previewYaml}</pre>
{/if}
```

#### テスト

* Component test(`@testing-library/svelte`): `admin/tournaments/new` で入力 → プレビューボタン押下 → `api['sheet-import'].preview.$post` が呼ばれることを mock で assert する
* 手動確認: dev サーバーでスプレッドシート取り込み〜YAML プレビュー〜保存までの一連のフローを確認する

#### 依存タスク

* Task 0-4, Task 2-1, Task 2-2, Task 2-3
