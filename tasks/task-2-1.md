[← tasks.md](../tasks.md) / Phase 2: 大会・フォーム定義管理(統括スタッフ)

### Task 2-1: 大会(tournament)管理 API ✅

#### 実装・更新内容

* `apps/backend/src/routes/tournaments.ts` に、統括スタッフのみが呼べる大会の作成・更新・一覧取得 API を実装する。
* すべてのボディを `zValidator` + `packages/shared` のスキーマで検証する。
* `apps/backend/src/index.ts` のルートチェーンに `.route('/tournaments', tournamentsRoute)` を追加する。

#### コードスニペット

`apps/backend/src/routes/tournaments.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { TournamentSchema } from '@regional-quiz/shared';
import type { Env } from '../types/env';
import { requireGeneralStaff } from '../middleware/staff-auth';
import { createDbClient } from '../lib/db';

const CreateTournamentSchema = TournamentSchema.omit({ id: true });

export const tournamentsRoute = new Hono<Env>()
  .use('*', requireGeneralStaff())
  .get('/', async (c) => {
    const db = createDbClient(c.env);
    const { data, error } = await db.from('tournaments').select('*');
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
  })
  .post('/', zValidator('json', CreateTournamentSchema), async (c) => {
    const db = createDbClient(c.env);
    const { data, error } = await db
      .from('tournaments')
      .insert(c.req.valid('json'))
      .select()
      .single();
    if (error) return c.json({ error: error.message }, 400);
    return c.json(data, 201);
  });
```

#### テスト

* In `apps/backend/src/routes/tournaments.test.ts`
  * `POST /tournaments creates a tournament for general staff`
    * 統括スタッフの認証コンテキストを付けてリクエストし、201 と作成された大会を assert する
  * `POST /tournaments rejects regional staff`
    * 地域スタッフのコンテキストでリクエストし、403 を assert する
  * `POST /tournaments rejects invalid body`
    * `entryOpensAt` を欠いたボディでリクエストし、400 を assert する

#### 依存タスク

* Task 1-2, Task 6-1(スタッフ認証ミドルウェア。並行実装可、認証部分はスタブでも可)
