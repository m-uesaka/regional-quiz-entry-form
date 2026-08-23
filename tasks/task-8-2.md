[← tasks.md](../tasks.md) / Phase 8: 非機能・仕上げ

### Task 8-2: デプロイパイプライン整備

#### 実装・更新内容

* GitHub Actions に、`main` ブランチへの push で `apps/backend` を Cloudflare Workers へ、`apps/frontend` を Cloudflare Pages へデプロイするジョブを追加する。
* Supabase マイグレーションを本番に適用するステップ(`supabase db push --linked`)を、デプロイ前に実行する。

#### コードスニペット

`.github/workflows/deploy.yml`

```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck && bun run test
      - name: Apply Supabase migrations
        run: supabase db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - name: Deploy backend
        run: bunx wrangler deploy
        working-directory: apps/backend
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Deploy frontend
        run: bunx wrangler pages deploy .svelte-kit/cloudflare
        working-directory: apps/frontend
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

#### テスト

* 手動確認: ステージング環境(または Cloudflare のプレビューデプロイ)で `healthz` エンドポイントとトップページが疎通することを確認する
* CI 上のジョブが正常終了することを確認する(マイグレーション未適用状態からの初回デプロイで確認)

#### 依存タスク

* Task 0-5, Task 0-6, Task 8-1
