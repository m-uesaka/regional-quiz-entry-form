[← tasks.md](../tasks.md) / Phase 0: モノレポ基盤構築 ✅完了

### Task 0-4: `apps/frontend` の SvelteKit 初期構成 ✅

#### 実装・更新内容

* `apps/frontend` に SvelteKit(Svelte 5)プロジェクトを作成し、`adapter-cloudflare` を設定する。
* `hc<AppType>()` を使った型安全 API クライアントの初期化コードを `src/lib/api.ts` に用意する(バックエンドの `AppType` を `@regional-quiz/backend` のような形で参照できるよう、`apps/backend` の型のみを参照する `exports` 設定を行う)。

#### コードスニペット

`apps/frontend/src/lib/api.ts`

```typescript
import { hc } from 'hono/client';
import type { AppType } from '../../../backend/src/index';

export function createApiClient(fetchImpl: typeof fetch = fetch) {
  return hc<AppType>('/api', { fetch: fetchImpl });
}
```

`apps/frontend/svelte.config.js`

```javascript
import adapter from '@sveltejs/adapter-cloudflare';

export default {
  kit: {
    adapter: adapter(),
  },
};
```

#### テスト

* 手動確認: `bun --filter ./apps/frontend dev` でトップページが表示できること
* 型チェック: `createApiClient().healthz.$get` のような呼び出しが型補完される(`AppType` が空でも解決できる)ことを確認

#### 依存タスク

* Task 0-1, Task 0-3(`AppType` の型を参照するため)
