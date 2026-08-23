[← tasks.md](../tasks.md) / Phase 6: 地域スタッフ向け管理ページ

### Task 6-2: エントリー状況一覧・詳細確認

#### 実装・更新内容

* `GET /staff/tournaments/:tournamentId/entries`(一覧、個人情報含む)と `GET /staff/entries/:entryId`(詳細)を実装する。`requireStaffForTournament()` で保護する。
* 対応する管理画面を `apps/frontend/src/routes/staff/[regionSlug]/[tournamentSlug]/entries/` に実装する。

#### コードスニペット

`apps/backend/src/routes/staff-entries.ts`

```typescript
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { requireStaffForTournament } from '../middleware/staff-auth';
import { createDbClient } from '../lib/db';

export const staffEntriesRoute = new Hono<Env>()
  .use('/:tournamentId/*', requireStaffForTournament())
  .get('/:tournamentId/entries', async (c) => {
    const db = createDbClient(c.env);
    const { data } = await db.from('entries').select('*').eq('tournament_id', c.req.param('tournamentId'));
    return c.json(data ?? []);
  });
```

#### テスト

* In `apps/backend/src/routes/staff-entries.test.ts`
  * `GET /staff/tournaments/:id/entries returns full entry data for authorized staff`
  * `GET /staff/tournaments/:id/entries returns 403 for staff of a different region`

#### 依存タスク

* Task 6-1, Task 3-3
