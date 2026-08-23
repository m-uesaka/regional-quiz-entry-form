[← tasks.md](../tasks.md) / Phase 0: モノレポ基盤構築 ✅完了

### Task 0-5: Supabase プロジェクト接続とマイグレーション基盤 ✅

#### 実装・更新内容

* Supabase プロジェクトを作成し、`apps/backend` から `@supabase/supabase-js` 経由で接続できるようにする(Cloudflare Workers は Node.js ランタイムではないため、`fetch` ベースで動く `@supabase/supabase-js` を採用する)。
* マイグレーション管理には Supabase CLI(`supabase/migrations/*.sql`)を使い、`bun run db:migrate` 相当のスクリプトを用意する。
* `apps/backend/src/lib/db.ts` に Supabase クライアントのファクトリを実装する。

#### コードスニペット

`apps/backend/src/lib/db.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types/env';

export function createDbClient(env: Bindings) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
```

`package.json`(ルート、追記)

```json
{
  "scripts": {
    "db:migrate": "supabase db push",
    "db:new": "supabase migration new"
  }
}
```

#### テスト

* 手動確認: ローカル Supabase(`supabase start`)に対して `db:migrate` が空のマイグレーションで成功すること
* In `apps/backend/src/lib/db.test.ts`
  * `createDbClient returns a client`
    * ダミーの env を渡してエラーなくインスタンスが生成されることを assert する

#### 依存タスク

* Task 0-3
