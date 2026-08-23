[← tasks.md](../tasks.md) / Phase 3: エントリーフォーム機能(参加者向け)

### Task 3-6: エントリー期間外アクセス制御 🔜次に着手可能

#### 実装・更新内容

* エントリーフォームページ(`+page.server.ts`)で、大会の `entry_opens_at` / `entry_closes_at` と現在時刻を比較し、期間外であればスタッフ認証(セッション)がない限りアクセスを拒否(403 相当のページ表示)する `load` 関数を実装する。
* 判定ロジック自体は `packages/shared` に共通関数として置き、バックエンド(Task 3-3)・フロント両方から使う。

#### コードスニペット

`packages/shared/src/logic/entry-period.ts`

```typescript
export function isWithinEntryPeriod(
  opensAt: string,
  closesAt: string,
  now: Date = new Date(),
): boolean {
  return now >= new Date(opensAt) && now <= new Date(closesAt);
}
```

`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/entry/+page.server.ts`

```typescript
import { error } from '@sveltejs/kit';
import { isWithinEntryPeriod } from '@regional-quiz/shared';
import { createApiClient } from '$lib/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
  const api = createApiClient(fetch);
  const res = await api.tournaments[':regionSlug'][':tournamentSlug'].$get({ param: params });
  if (!res.ok) throw error(404, 'tournament not found');
  const tournament = await res.json();

  if (!isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt) && !locals.staff) {
    throw error(403, 'エントリー期間外です');
  }

  return { tournament };
};
```

#### テスト

* In `packages/shared/src/logic/entry-period.test.ts`
  * `isWithinEntryPeriod returns true within the window`
  * `isWithinEntryPeriod returns false before opening / after closing`
* Component/route test: `locals.staff` が無い状態で期間外にアクセスすると 403 が throw されることを assert する。`locals.staff` がある場合はアクセスできることを assert する

#### 依存タスク

* Task 2-1, Task 6-1(スタッフセッションの `locals.staff` を提供)
