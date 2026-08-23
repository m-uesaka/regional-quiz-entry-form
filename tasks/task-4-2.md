[← tasks.md](../tasks.md) / Phase 4: エントリーリスト公開機能

### Task 4-2: 公開エントリーリストページ

#### 実装・更新内容

* `apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/list/+page.svelte` を実装し、Task 4-1 の API を `+page.server.ts` の `load` で取得して一覧表示する(認証不要・常時公開)。

#### コードスニペット

`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/list/+page.server.ts`

```typescript
import { createApiClient } from '$lib/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
  const api = createApiClient(fetch);
  const res = await api.tournaments[':tournamentId']['entry-list'].$get({
    param: { tournamentId: params.tournamentSlug },
  });
  return { entries: await res.json() };
};
```

`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/list/+page.svelte`

```svelte
<script lang="ts">
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
</script>

<ul>
  {#each data.entries as entry (entry.displayName + entry.waitlistPosition)}
    <li>
      {entry.displayName}
      {#if entry.status === 'waitlisted'}(キャンセル待ち {entry.waitlistPosition}){/if}
    </li>
  {/each}
</ul>
```

#### テスト

* Component test: `waitlisted` の entry に「キャンセル待ち」表記が出ることを assert する
* 手動確認: 期間外・期間内どちらでもリストページが閲覧できることを確認する(要件上、公開リストはアクセス制限の対象外)

#### 依存タスク

* Task 4-1, Task 0-4
