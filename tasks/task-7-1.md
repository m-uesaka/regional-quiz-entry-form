[← tasks.md](../tasks.md) / Phase 7: 統括スタッフ向け管理ページ

### Task 7-1: 全地域横断ダッシュボード

#### 実装・更新内容

* 統括スタッフ向けに、全地域・全大会のエントリー状況(件数、定員に対する充足率、キャンセル待ち件数)を一覧できる `GET /staff/dashboard` API と画面を実装する。
* Task 6-2 / 6-3 / 6-4 の地域スタッフ向け機能を、`region_id` を跨いで(`requireGeneralStaff()` を使い)呼べるようにする(内部的には既存 API のスコープを外すだけで、新規ロジックの追加は最小限)。

#### コードスニペット

`apps/backend/src/routes/staff-dashboard.ts`

```typescript
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { requireGeneralStaff } from '../middleware/staff-auth';
import { createDbClient } from '../lib/db';

export const staffDashboardRoute = new Hono<Env>()
  .use('*', requireGeneralStaff())
  .get('/', async (c) => {
    const db = createDbClient(c.env);
    const { data } = await db.rpc('tournament_entry_summary');
    // tournament_entry_summary: tournament_id, confirmed_count, waitlisted_count, capacity を返す DB 関数(SQL マイグレーションで追加)
    return c.json(data ?? []);
  });
```

`supabase/migrations/0002_tournament_entry_summary.sql`

```sql
create or replace function tournament_entry_summary()
returns table (
  tournament_id uuid,
  region_id uuid,
  confirmed_count bigint,
  waitlisted_count bigint,
  capacity integer
) as $$
  select
    t.id,
    t.region_id,
    count(*) filter (where e.status = 'confirmed'),
    count(*) filter (where e.status = 'waitlisted'),
    t.capacity
  from tournaments t
  left join entries e on e.tournament_id = t.id
  group by t.id;
$$ language sql stable;
```

#### テスト

* In `apps/backend/src/routes/staff-dashboard.test.ts`
  * `GET /staff/dashboard returns summary rows across all regions`
    * 複数地域・複数大会にエントリーを作成し、`confirmed_count` / `waitlisted_count` が正しく集計されることを assert する
  * `GET /staff/dashboard rejects regional staff`

#### 依存タスク

* Task 6-1, Task 6-2
