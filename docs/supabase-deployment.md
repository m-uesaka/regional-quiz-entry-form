# Supabase デプロイ手順書(テスト環境・本番環境)

このドキュメントは、`supabase/migrations/` で管理しているスキーマを Supabase のテスト環境(staging)・本番環境(production)へ適用し、`apps/backend`(Cloudflare Workers)・`apps/frontend`(Cloudflare Pages)と接続するまでの手順をまとめたものです。

> **前提**: 2026-08-23 時点では Supabase プロジェクトの実体(staging/production)はまだ作成されていません。ローカルの `supabase/` 配下にはマイグレーション(`0001_init.sql` 等)のみが存在します。本ドキュメントは `tasks.md` の Task 0-5(Supabase 接続基盤)・Task 8-2(デプロイパイプライン整備)を実施する際の runbook として使ってください。

## 1. 環境の全体像

| 環境 | Supabase プロジェクト | 用途 | マイグレーション適用方法 | 接続先 |
| --- | --- | --- | --- | --- |
| ローカル | Supabase CLI のローカルスタック(Docker) | 開発・単体/統合テスト | `bun run db:migrate`(= `supabase db push --local`) | `apps/backend` はローカル Supabase(`http://127.0.0.1:54321`) |
| テスト環境(staging) | 専用の Supabase プロジェクト(例: `regional-quiz-entry-form-staging`) | PR ごとの動作確認・E2E・本番反映前の最終確認 | GitHub Actions から `supabase db push --linked` | Cloudflare Workers/Pages の staging 環境 |
| 本番環境(production) | 専用の Supabase プロジェクト(例: `regional-quiz-entry-form`) | 実運用 | `main` マージ時に GitHub Actions から `supabase db push --linked` | Cloudflare Workers/Pages の production 環境 |

**重要な方針**:

- staging と production は必ず**別々の Supabase プロジェクト**として作成する(同一プロジェクト内のスキーマ切り替えではない)。本番データとテストデータを物理的に分離するため。
- スキーマ変更は必ず `supabase/migrations/*.sql` 経由で行う。Supabase Studio の GUI で staging/production のテーブルを直接編集しない(次回マイグレーション適用時に不整合が起きるため)。
- 適用順序は常に「ローカルで検証 → テスト環境に適用して確認 → 本番環境に適用」。テスト環境をスキップして本番に直接適用しない。

## 2. 前提条件

- Supabase CLI がルートの `devDependencies`(`supabase`)としてインストール済み(`bunx supabase --version` で確認)
- Supabase の Organization に対する権限を持つアカウント(プロジェクト作成・Access Token 発行に必要)
- Cloudflare アカウント(Workers/Pages のデプロイ権限)
- GitHub リポジトリの Secrets / Environments を設定できる権限(Admin)

## 3. Supabase プロジェクトの作成

Supabase Dashboard(https://supabase.com/dashboard)で、staging・production 用にそれぞれ新規プロジェクトを作成します。

1. 「New Project」から Organization を選び、プロジェクト名を入力(例: `regional-quiz-entry-form-staging` / `regional-quiz-entry-form`)
2. リージョンは想定ユーザーに近いリージョン(例: `Northeast Asia (Tokyo)`)を選択。**staging と production は同一リージョンに揃える**(挙動差異を避けるため)
3. DB パスワードは自動生成されたものを使い、1Password 等のシークレット管理ツールに保存する(後述のシークレットにも使う)
4. 作成後、`Project Settings > General` から **Project ID(project ref)** を控える。GitHub Actions の Secrets(`SUPABASE_STAGING_PROJECT_ID` / `SUPABASE_PRODUCTION_PROJECT_ID`)に使う
5. `Project Settings > API` から以下を控える(Cloudflare Workers のシークレットに使う)
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`(**絶対にフロントエンドや公開リポジトリに含めない**)

## 4. ローカル開発環境

```bash
# ローカルの Supabase スタック(Postgres, Studio 等)を起動
bunx supabase start

# supabase/migrations/*.sql をローカル DB に適用
bun run db:migrate

# 新規マイグレーションファイルを作成
bun run db:new <migration_name>

# ローカル DB をリセットして全マイグレーション + シードを再適用
bunx supabase db reset

# 停止
bunx supabase stop
```

ローカルで `bun run db:migrate` がエラーなく通ることを確認してから、次のステップ(テスト環境への適用)に進みます。

## 5. Supabase CLI でのプロジェクトリンクと手動デプロイ

CLI はディレクトリ単位で1つのプロジェクトとしかリンクを保持できない(`supabase/.temp/project-ref` に保存される)ため、staging/production を切り替える際は都度 `link` し直します。CI では毎回リンクし直すため問題になりませんが、**手動でローカルから適用する場合は、今どちらにリンクされているか(`cat supabase/.temp/project-ref`)を必ず確認してから実行してください**。

```bash
# Supabase へログイン(Personal Access Token を使う場合は環境変数でも可)
bunx supabase login

# --- テスト環境への手動適用 ---
bunx supabase link --project-ref <SUPABASE_STAGING_PROJECT_ID>
bunx supabase db push --linked   # ルートの `bun run db:migrate:remote` と同等(リンク先が staging の場合)

# --- 本番環境への手動適用 ---
bunx supabase link --project-ref <SUPABASE_PRODUCTION_PROJECT_ID>
bunx supabase db push --linked
```

適用前に差分を確認したい場合は `bunx supabase db push --linked --dry-run` を使います。本番適用前は必ず dry-run で差分を確認してください。

手動適用は緊急時のみとし、通常運用は 7 章の GitHub Actions ワークフローに任せます。

## 6. 環境変数・シークレット管理

### 6.1 Supabase 側の値

| 名前 | 用途 | 発行元 |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | CLI/CI からのログイン・`db push --linked` に使用する Personal Access Token | Supabase Dashboard > Account > Access Tokens |
| `SUPABASE_URL` | `@supabase/supabase-js` の接続先(環境ごとに異なる) | 各プロジェクトの `Project Settings > API` |
| `SUPABASE_SERVICE_ROLE_KEY` | バックエンドが RLS をバイパスして操作するためのキー(環境ごとに異なる) | 各プロジェクトの `Project Settings > API` |

### 6.2 Cloudflare Workers(`apps/backend`)側

`apps/backend/wrangler.toml` に `staging` / `production`(デフォルト環境)の 2 環境を定義し、環境ごとにシークレットを登録します。

```toml
# apps/backend/wrangler.toml
name = "regional-quiz-backend"
main = "src/index.ts"
compatibility_date = "2026-08-01"

[vars]
# 非機密の設定値のみここに記載し、機密情報は `wrangler secret put` で登録する

[env.staging]
name = "regional-quiz-backend-staging"

[env.production]
name = "regional-quiz-backend"
```

各環境に対して、`apps/backend/src/types/env.ts` の `Bindings` に対応するシークレットを登録します。

```bash
cd apps/backend

# staging
bunx wrangler secret put SUPABASE_URL --env staging
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
bunx wrangler secret put MAIL_API_KEY --env staging
bunx wrangler secret put SESSION_SECRET --env staging

# production(--env を付けない、または --env production)
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
bunx wrangler secret put MAIL_API_KEY --env production
bunx wrangler secret put SESSION_SECRET --env production
```

`SESSION_SECRET` は staging/production で必ず異なる値を発行してください(`openssl rand -base64 32` などで生成)。

### 6.3 GitHub Actions 側

リポジトリの `Settings > Environments` に `staging` と `production` の2つの Environment を作成し、それぞれに以下の Secrets を登録します。production 環境には **Required reviewers** を設定し、本番デプロイ前に人手のレビューを挟むことを推奨します。

| Secret 名 | staging | production |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | 共通(同じトークンを両 Environment に登録可) | 同左 |
| `SUPABASE_PROJECT_ID` | staging プロジェクトの project ref | production プロジェクトの project ref |
| `CLOUDFLARE_API_TOKEN` | Workers/Pages への Edit 権限を持つトークン | 同左(スコープを分けたい場合は環境ごとに別トークンでも可) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID | 同左 |

## 7. CI/CD パイプライン

`ci.yml`(typecheck/lint/test)に加えて、以下の2ワークフローを追加します。GitHub Environments の `staging`/`production` を使うことで、Secrets の参照先を1つのワークフローファイル内で切り替えられます。

### 7.1 テスト環境への自動デプロイ

`main` 以外のブランチへの push(または任意のタイミングでの手動実行)で staging に反映します。

```yaml
# .github/workflows/deploy-staging.yml
name: deploy-staging
on:
  push:
    branches-ignore: [main]
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck && bun run test

      - name: Link Supabase project
        run: bunx supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_ID }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Apply Supabase migrations (staging)
        run: bunx supabase db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Deploy backend (staging)
        run: bunx wrangler deploy --env staging
        working-directory: apps/backend
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy frontend (staging)
        run: bunx wrangler pages deploy .svelte-kit/cloudflare --project-name regional-quiz-frontend-staging
        working-directory: apps/frontend
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### 7.2 本番環境への自動デプロイ

`main` ブランチへのマージをトリガーとします。`environment: production` を指定することで、Environment 側の Required reviewers 設定が効き、承認が下りるまでジョブが待機します。

```yaml
# .github/workflows/deploy-production.yml
name: deploy-production
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck && bun run test

      - name: Link Supabase project
        run: bunx supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_ID }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Preview migration diff
        run: bunx supabase db push --linked --dry-run
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Apply Supabase migrations (production)
        run: bunx supabase db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Deploy backend (production)
        run: bunx wrangler deploy --env production
        working-directory: apps/backend
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy frontend (production)
        run: bunx wrangler pages deploy .svelte-kit/cloudflare --project-name regional-quiz-frontend
        working-directory: apps/frontend
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

> 実装時の注意: 上記2ファイルはステップ構成がほぼ同一のため、`workflow_call` で共通ワークフローに切り出し `environment` / `project-name` だけを入力パラメータ化する方が保守しやすい場合があります。Task 8-2 着手時に検討してください。

## 8. デプロイ後の確認

- `GET https://<worker-domain>/healthz` が `{ ok: true }` を返すこと
- フロントエンドのトップページが表示され、`hc<AppType>()` 経由の API 呼び出しが疎通すること
- Supabase Dashboard の `Table Editor` で、適用したマイグレーション分のテーブル・型(enum)が反映されていること
- Supabase Dashboard の `Database > Migrations` で、適用済みマイグレーションの一覧に最新のものが含まれること

## 9. ロールバック・障害対応

- **マイグレーション**: Supabase CLI のマイグレーションは基本的に「進む」方向のみ管理する(down マイグレーションを自動生成しない)。誤ったマイグレーションを適用してしまった場合は、変更を打ち消す新しいマイグレーションを作成して適用する(例: `ALTER TABLE ... DROP COLUMN` を追加したマイグレーションを新規作成)。適用済みマイグレーションのファイルを直接書き換えない。
- **Cloudflare Workers**: `bunx wrangler rollback --env production`(または対象 env)で直前のデプロイに戻せる。
- **Cloudflare Pages**: Dashboard の `Deployments` タブから任意の過去デプロイを「Rollback to this deployment」で切り戻せる。
- **DB のバックアップ**: Supabase の Point-in-Time Recovery(有料プラン)または `Database > Backups` の日次バックアップから復元する。production プロジェクトでは PITR の有効化を検討する。

## 10. 新規環境構築チェックリスト

- [ ] Supabase プロジェクトを作成した(staging / production)
- [ ] プロジェクトのリージョンを揃えた
- [ ] `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を控えた
- [ ] `Project Settings > General` の project ref を控えた
- [ ] `SESSION_SECRET` を環境ごとに個別発行した
- [ ] GitHub の `staging` / `production` Environments を作成し、Secrets を登録した
- [ ] production Environment に Required reviewers を設定した
- [ ] `wrangler.toml` に `env.staging` / `env.production` を追加した
- [ ] 各環境に `wrangler secret put` でシークレットを登録した
- [ ] `bunx supabase db push --linked --dry-run` で初回マイグレーション適用の差分を確認した
- [ ] staging で `db:migrate:remote` 相当のジョブが通ることを確認した
- [ ] production への初回デプロイ後、`/healthz` とトップページの疎通を確認した

## 11. 参考リンク

- Supabase CLI Local Development: https://supabase.com/docs/guides/local-development
- Supabase CLI Managing Environments: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase CLI コマンドリファレンス: https://supabase.com/docs/reference/cli
- Wrangler Environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Wrangler Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Pages デプロイ(Wrangler 経由): https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
