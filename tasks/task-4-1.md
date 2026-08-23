[← tasks.md](../tasks.md) / Phase 4: エントリーリスト公開機能

### Task 4-1: 公開エントリーリスト API

#### 実装・更新内容

* `GET /tournaments/:tournamentId/entry-list` を実装し、`confirmed` / `waitlisted` / `cancelled` のエントリーについて `displayName` とステータスのみを返す(個人情報である `name` / `furigana` / `email` / `freeText` 等は含めない)。
* `cancelled` は名前の代わりに「キャンセル」を返す(繰り上げは行わないため、順番はそのまま)。

#### コードスニペット

`apps/backend/src/routes/entry-list.ts`

```typescript
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { createDbClient } from '../lib/db';

export const entryListRoute = new Hono<Env>().get('/:tournamentId/entry-list', async (c) => {
  const db = createDbClient(c.env);
  const { data } = await db
    .from('entries')
    .select('display_name, status, waitlist_position, created_at')
    .eq('tournament_id', c.req.param('tournamentId'))
    .in('status', ['confirmed', 'waitlisted', 'cancelled'])
    .order('created_at', { ascending: true });

  const list = (data ?? []).map((entry) => ({
    displayName: entry.status === 'cancelled' ? 'キャンセル' : entry.display_name,
    status: entry.status,
    waitlistPosition: entry.waitlist_position,
  }));
  return c.json(list);
});
```

#### テスト

* In `apps/backend/src/routes/entry-list.test.ts`
  * `GET entry-list omits personal fields`
    * レスポンス body に `email` / `name` / `furigana` キーが含まれないことを assert する
  * `GET entry-list masks cancelled entries as "キャンセル"`
    * `cancelled` の entry が `displayName: 'キャンセル'` で返ることを assert する

#### 依存タスク

* Task 1-1, Task 3-5
