[← tasks.md](../tasks.md) / Phase 0: モノレポ基盤構築 ✅完了

### Task 0-3: `apps/backend` の Hono + Cloudflare Workers 初期構成 ✅

#### 実装・更新内容

* `apps/backend` に Hono アプリの雛形を作成し、`wrangler.toml` で Cloudflare Workers 向けの設定(bindings は Phase 1 以降で追加)を用意する。
* `Bindings` / `Variables` の型を1箇所にまとめ、`Hono<Env>()` で生成する。
* ルートをチェーンして `AppType` をエクスポートする形を、空のヘルスチェックルートで先に確立しておく(以降のタスクで `routes/*` をチェーンに足していく)。

#### コードスニペット

`apps/backend/src/types/env.ts`

```typescript
export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAIL_API_KEY: string;
  SESSION_SECRET: string;
}

export interface Variables {
  requestId: string;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
```

`apps/backend/src/index.ts`

```typescript
import { Hono } from 'hono';
import type { Env } from './types/env';

const app = new Hono<Env>();

const routes = app.get('/healthz', (c) => c.json({ ok: true }));
// 以降のタスクで .route('/tournaments', tournamentsRoute) のようにチェーンしていく

export type AppType = typeof routes;
export default app;
```

`apps/backend/wrangler.toml`

```toml
name = "regional-quiz-backend"
main = "src/index.ts"
compatibility_date = "2026-08-01"

[vars]
# 非機密の設定値のみここに記載し、機密情報は `wrangler secret put` で登録する
```

#### テスト

* In `apps/backend/src/index.test.ts`
  * `GET /healthz returns ok`
    * `app.request('/healthz')` を呼び、ステータス 200 と `{ ok: true }` を assert する

#### 依存タスク

* Task 0-1
