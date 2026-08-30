# Supabase デプロイ手順書(テスト環境・本番環境)

このドキュメントは、`supabase/migrations/` で管理しているスキーマを Supabase のテスト環境(staging)・本番環境(production)へ適用し、`apps/backend`(Cloudflare Workers)・`apps/frontend`(Cloudflare Pages)と接続するまでの手順をまとめたものです。

> **前提**: パイプライン側(`.github/workflows/deploy*.yml`、`apps/backend/wrangler.toml` の環境定義)は Task 8-2(#42)で実装済みですが、Supabase プロジェクトと Cloudflare Workers/Pages プロジェクトの実体、および GitHub Environments の Secrets はまだ作成されていません。本ドキュメントはそれらを作成して初回デプロイを通すための runbook です。作成が済むまで `deploy-staging` / `deploy-production` はシークレット未設定で失敗します。

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
3. DB パスワードは自動生成されたものを使い、1Password 等のシークレット管理ツールに保存する。GitHub Actions の Secret `SUPABASE_DB_PASSWORD` にも登録する(CI の `supabase db push` が DB 接続に使う)
4. 作成後、`Project Settings > General` から **Project ID(project ref)** を控える。GitHub Actions の Secret `SUPABASE_PROJECT_ID` に使う(staging / production の Environment ごとに別の値を登録する)
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

### 5.1 remote より古いタイムスタンプのマイグレーション

`db push` は、リモートに適用済みの最後のマイグレーションより古いタイムスタンプのファイルを見つけると `Found local migration files to be inserted before the last migration on remote database` で停止します。staging は全ブランチが共有するため、これは日常的に起きます — ブランチ A(新しいマイグレーション)が staging にデプロイされた後にブランチ B(古いマイグレーション)を push すると、B の staging デプロイがここで落ちます。

順序の入れ替わりが意図通りであれば `--include-all` を付けて適用します。意図通りでない(= 実際に順序依存がある)場合は、マイグレーションファイルを rebase してタイムスタンプを振り直してください。**production で `--include-all` に頼るのは避け、production に到達する前に staging で解消しておきます。**

## 6. 環境変数・シークレット管理

### 6.1 Supabase 側の値

| 名前 | 用途 | 発行元 |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | CLI/CI からのログイン・`db push --linked` に使用する Personal Access Token | Supabase Dashboard > Account > Access Tokens |
| `SUPABASE_URL` | `@supabase/supabase-js` の接続先(環境ごとに異なる) | 各プロジェクトの `Project Settings > API` |
| `SUPABASE_SERVICE_ROLE_KEY` | バックエンドが RLS をバイパスして操作するためのキー(環境ごとに異なる) | 各プロジェクトの `Project Settings > API` |
| `SUPABASE_DB_PASSWORD` | `link` / `db push --linked` が Postgres へ接続するためのパスワード(環境ごとに異なる) | プロジェクト作成時に生成した DB パスワード |

### 6.2 Cloudflare Workers(`apps/backend`)側

`apps/backend/wrangler.toml` に `staging` / `production` の 2 環境を定義済みです。実ファイルを参照してください。編集する際の注意点は 2 つです。

- **`vars` と `routes` は環境に継承されない**。`[env.staging]` に `[env.staging.vars]` を書かないと、トップレベルの `[vars]` ではなく「vars なし」でデプロイされます(Wrangler の non-inheritable key)。そのため両環境がそれぞれ自分の `vars` を持っており、トップレベルの `[vars]` は `wrangler dev`(無名環境)専用です。
- **`[env.production]` で `name` を上書きしている**。`--env production` はデフォルトで Worker 名に `-production` を付けるため、明示しないと `regional-quiz-backend-production` にデプロイされます。

各環境に対して、`apps/backend/src/types/env.ts` の `Bindings` のうち機密であるものをシークレットとして登録します(`MAIL_FROM_ADDRESS` / `FRONTEND_URL` は `wrangler.toml` の `vars` 側なので不要)。

```bash
cd apps/backend

# staging
bunx wrangler secret put SUPABASE_URL --env staging
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
bunx wrangler secret put MAIL_API_KEY --env staging
bunx wrangler secret put GOOGLE_SHEETS_API_KEY --env staging
bunx wrangler secret put SESSION_SECRET --env staging
bunx wrangler secret put TURNSTILE_SECRET_KEY --env staging

# production
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
bunx wrangler secret put MAIL_API_KEY --env production
bunx wrangler secret put GOOGLE_SHEETS_API_KEY --env production
bunx wrangler secret put SESSION_SECRET --env production
bunx wrangler secret put TURNSTILE_SECRET_KEY --env production
```

`SESSION_SECRET` は staging/production で必ず異なる値を発行してください(`openssl rand -base64 32` などで生成)。シークレットは `wrangler deploy` では変更されないため、この登録は環境ごとに一度だけで済みます。

`TURNSTILE_SECRET_KEY` は Cloudflare Dashboard の `Turnstile` で widget を作成すると発行される **Secret Key** です(#116)。ウィジェットは環境ごとに 1 つ作り、その **Site Key** を Pages 側の `PUBLIC_TURNSTILE_SITE_KEY`(6.3)に、Secret Key をここに登録します。widget のドメイン設定には、その環境でフォームを表示するホスト名を入れてください。

> **`[env.*.vars]` に `TURNSTILE_SECRET_KEY` を書かないでください。** 同名の var があるとデプロイのたびにシークレットが平文の var で上書きされます。トップレベルの `[vars]` にはローカル開発用のテスト鍵(Cloudflare が公開している「常に成功する」固定値)が入っていますが、`vars` は環境に継承されないため `--env` 付きのデプロイには影響しません。
>
> このため `wrangler deploy --env <name>` は毎回 `"vars.TURNSTILE_SECRET_KEY" exists at the top level, but not on "env.<name>.vars"` と警告します。**想定どおりの警告で、指示どおりに追記してはいけません。**

### 6.2.1 レート制限の binding

`wrangler.toml` の各環境に `LOGIN_IP_RATE_LIMITER` / `LOGIN_EMAIL_RATE_LIMITER` / `MAIL_TRIGGER_IP_RATE_LIMITER` / `MAIL_TRIGGER_EMAIL_RATE_LIMITER`(Cloudflare の Rate Limiting binding)を定義済みです(#116)。**登録作業は不要**で、`namespace_id` は Cloudflare 側の資源を指すものではなく「どのカウンタか」を表すだけの識別子です。ただし環境をまたいで同じ id を使うと staging の負荷が production の枠を食うため、`wrangler.toml` では環境ごとに別の値にしてあります。ここを編集するときは、`period` に **10 か 60 しか指定できない**点にも注意してください。

### 6.2.2 一斉メール用の Queue

スタッフの一斉メールは Cloudflare Queues のコンシューマが送ります(Task 10-4 / #114)。`wrangler.toml` の各環境に producer(`BULK_MAIL_QUEUE`)と consumer を定義済みですが、**キューそのものは先に作っておく必要があります**。存在しないキュー名を指す `wrangler deploy` は失敗します。

> **Queues は Workers Paid(有料)プラン限定の機能です。** ローカル開発と E2E は `wrangler dev` がキューを模擬するので課金は要りませんが、デプロイ先のアカウントが無料プランのままだとこの機能は使えません。その場合の代替は Cloudflare Workflows か、Cron Trigger で送信待ち行列を掃き出す方式で、いずれも `apps/backend/src/lib/bulk-mail-queue.ts` の置き換えになります。

環境ごとに本体と dead letter queue の 2 本ずつ作ります(名前は `wrangler.toml` の `queue` / `dead_letter_queue` と一致させてください)。

```bash
cd apps/backend

# staging
bunx wrangler queues create regional-quiz-bulk-mail-staging
bunx wrangler queues create regional-quiz-bulk-mail-staging-dlq

# production
bunx wrangler queues create regional-quiz-bulk-mail
bunx wrangler queues create regional-quiz-bulk-mail-dlq
```

キューを環境ごとに分けているのは、1 本を共有すると staging の送信テストのメッセージを production の Worker が拾い、**本物のメールとして送ってしまう**ためです。dead letter queue には、3 回の再配信でも送れなかった宛先のメッセージが残ります(コンシューマ側でも最終配信で諦めて `mail_jobs.failed` に計上するので、件数はスタッフ画面から見えます)。

### 6.3 Cloudflare Pages(`apps/frontend`)側

Pages プロジェクトを staging / production 用にそれぞれ作成します。ワークフローは `wrangler pages deploy --branch main` でアップロードするため、**production branch は `main` にしてください**(一致しないとすべて preview デプロイ扱いになり、本番 URL が更新されません)。

```bash
cd apps/frontend

bunx wrangler pages project create regional-quiz-frontend-staging --production-branch main
bunx wrangler pages project create regional-quiz-frontend --production-branch main
```

`src/hooks.server.ts` は `$env/dynamic/private` から 2 つの値を、`Turnstile.svelte` は `$env/dynamic/public` から 1 つを読むので、Pages プロジェクトの変数として登録します。

| 名前 | 種別 | 値 |
| --- | --- | --- |
| `BACKEND_URL` | 通常の変数 | **その環境のバックエンド Worker 自身のオリジン**。production は `https://regional-quiz-backend.<subdomain>.workers.dev`、staging は `https://regional-quiz-backend-staging.<subdomain>.workers.dev`(`<subdomain>` は Cloudflare アカウントごとの workers.dev サブドメイン)。SSR の `handleFetch` が `/api/*` の転送先に使う。**フロントエンドのホスト名ではない**(6.4) |
| `SESSION_SECRET` | シークレット | **同じ環境の Worker に登録したものと同一の値**。ズレるとログイン直後のセッションが読めず `/staff/*` がログイン画面に跳ね返される |
| `PUBLIC_TURNSTILE_SITE_KEY` | 通常の変数 | 6.2 で作成した Turnstile widget の **Site Key**。エントリーフォームとパスワード再設定要求フォームのウィジェットが読む。未設定だとウィジェットが描画されず、トークンが無い送信をバックエンドが 400 で拒否するため、**この 2 つのフォームが誰にも使えなくなる** |

```bash
bunx wrangler pages secret put SESSION_SECRET --project-name regional-quiz-frontend
```

`BACKEND_URL` は機密ではないので Dashboard の `Settings > Environment variables` から登録しても構いません。いずれも Pages プロジェクト側の設定で、`wrangler pages deploy` では上書きされません。

`BACKEND_URL` に **workers.dev のオリジンを入れる**のは、これが route の有無に関わらず常に有効なオリジンだからです。`apps/backend/wrangler.toml` の `workers_dev = true` がそれを保証しています(このキーが無いと、6.4 で route を付けた瞬間に wrangler が workers.dev を無効化し、SSR の転送先が消えます)。6.4 で実ドメインを有効化しても `BACKEND_URL` は**変更不要**です。

### 6.4 `/api/*` をバックエンド Worker へ振り分ける

フロントエンドは同一オリジンの `/api/*` を叩きます(`apps/frontend/src/lib/api.ts`)。`apps/frontend` 側にこれを転送する仕組みはなく、`vite.config.ts` の proxy は `vite dev` 専用です。本番でこれを担うのが **Worker route** です。同一ホスト名に対して Workers route は Pages プロジェクトより優先されるため、`/api/*` だけが Hono に届き、それ以外は Pages が返します。

route が無いと、SSR(`load` / `actions`)からの呼び出しは `src/hooks.server.ts` の `handleFetch` が `BACKEND_URL` へ書き換えるので動きますが、**ブラウザが自分で発行する呼び出しはすべて 404 になります**(CSV ダウンロードのリンク、クライアント側の `createApiClient()`)。ページは描画されるのに一部の操作だけが壊れるため、気づきにくい壊れ方をします。

#### 設定手順

`wrangler.toml` に `routes` は書きません。Wrangler は route のゾーンをデプロイ時に Cloudflare アカウントへ問い合わせるため、アカウントが持たないゾーンを書くと `wrangler deploy` 自体が落ち、振り分けではなく**パイプラインが壊れます**。代わりに `.github/workflows/deploy.yml` が、その環境の `FRONTEND_HOST` 変数が設定されているときだけ route を付けてデプロイします。

```bash
bunx wrangler deploy --env production \
  --route "$FRONTEND_HOST/api/*" \
  --var "FRONTEND_URL:https://$FRONTEND_HOST"
```

つまり実ドメインの有効化は**設定変更だけ**で済み、リポジトリ側の編集は要りません。

1. ドメインを取得し、Cloudflare のゾーンに追加する
2. Pages プロジェクト(production / staging)にカスタムドメインを割り当てる(6.3)
3. GitHub の `staging` / `production` Environment に `FRONTEND_HOST` 変数を登録する(6.5)
4. デプロイし直す

Pages の `BACKEND_URL`(6.3)はここでは触りません。SSR の転送先は route ではなく Worker 自身のオリジン、つまり workers.dev のままで正しく、`wrangler.toml` の `workers_dev = true` がそれを維持します。ここで `BACKEND_URL` をフロントエンドのホスト名に書き換える必要はありません。

`FRONTEND_HOST` にはスキームもパスも付けず、**ホスト名だけ**を入れます(例: `entry.example.jp` / `staging.entry.example.jp`)。route のパターンと Pages のカスタムドメインは同一ホストでなければ意味がない(そのホストを Pages が持っているからこそ Workers route が優先される)ため、両者を別々の設定にせず 1 つの変数から導出しています。

`FRONTEND_URL` を同じ変数から上書きしているのも同じ理由です。これは `src/lib/entry-verification.ts` とパスワード再設定メールがリンクを組み立てる URL で、値がずれても**サイトは正常に見えます**。壊れるのはメール内のリンクだけなので、デプロイ時には誰も気づきません。`--var` は環境の vars を置き換えではなく**マージ**するので、`MAIL_FROM_ADDRESS` は `wrangler.toml` の値のまま、`wrangler secret put` で登録したシークレット(`TURNSTILE_SECRET_KEY` 等)もそのまま引き継がれます。

> `MAIL_FROM_ADDRESS` だけは `apps/backend/wrangler.toml` の `[env.*.vars]` を手で書き換えてください。送信元ドメインはメール事業者側で検証済みのドメインであって、サイトのホスト名とは限らないため、`FRONTEND_HOST` からは導出していません。現状は `regionalquiz.example` のプレースホルダのままです。

#### 疎通確認

`deploy.yml` の最後のステップ `Smoke test the /api/* route` が、`FRONTEND_HOST` が設定されている環境で `https://$FRONTEND_HOST/api/healthz` を叩き、`{"ok":true}` が返らなければデプロイを失敗させます(route の伝播待ちのため最大 5 回リトライ)。Worker は `basePath('/api')` を張っているので、このパスはバックエンドにしか存在せず、200 が返ればそれ自体が route の効いている証拠になります。

手で確かめる場合も同じです。

```bash
curl -i "https://<frontend-host>/api/healthz"   # => {"ok":true}
```

> `routes` を手で `wrangler.toml` に書き足す場合は、必ず `[env.*]` の**直下**に置いてください。`[env.*.vars]` の下に置くと `routes` という名前の var として解釈され、警告もエラーも出ないまま route 無しでデプロイされます(#100 で実際に踏みました)。

### 6.5 GitHub Actions 側

リポジトリの `Settings > Environments` に `staging` と `production` の2つの Environment を作成し、それぞれに以下の Secrets を登録します。production 環境には **Required reviewers** を設定し、本番デプロイ前に人手のレビューを挟むことを推奨します(`deploy-production.yml` は最初のステップの前で承認待ちになります)。

| Secret 名 | staging | production |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | 共通(同じトークンを両 Environment に登録可) | 同左 |
| `SUPABASE_PROJECT_ID` | staging プロジェクトの project ref | production プロジェクトの project ref |
| `SUPABASE_DB_PASSWORD` | staging プロジェクト作成時の DB パスワード | production プロジェクトの DB パスワード |
| `CLOUDFLARE_API_TOKEN` | Workers/Pages への Edit 権限を持つトークン | 同左(スコープを分けたい場合は環境ごとに別トークンでも可) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID | 同左 |

`SUPABASE_DB_PASSWORD` は `supabase link` / `supabase db push --linked` が DB へ接続するのに使います。未登録だと CI は対話プロンプトを出せずに失敗します。

同じ Environment に、機密でない **Variables** も 1 つ登録します(`Settings > Environments > <環境> > Environment variables`。Secrets ではなく Variables 側です)。

| 変数名 | staging | production |
| --- | --- | --- |
| `FRONTEND_HOST` | staging のフロントエンドのホスト名(例: `staging.entry.example.jp`) | production のホスト名(例: `entry.example.jp`) |

スキームもパスも付けない**ホスト名のみ**です。`deploy.yml` はこれを使って Worker の `/api/*` route と `FRONTEND_URL` を組み立て、デプロイ後の疎通確認も行います(6.4)。**未設定でもデプロイは成功します**が、その場合 route が付かないため、ブラウザから直接叩く API がすべて 404 になります(ワークフローのログに warning が出ます)。

## 7. CI/CD パイプライン

`ci.yml`(typecheck/lint/test/e2e)に加えて、デプロイ用に 3 ファイルを置いています。ステップ構成が staging と production でほぼ同一なため、実体は `workflow_call` の再利用ワークフロー 1 つで、呼び出し側は環境ごとの差分だけを渡します。

| ファイル | トリガー | 役割 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | `workflow_call` | 実体。checkout → `bun install` → typecheck/test → フロントエンドのビルド → Supabase link → マイグレーション適用 → Worker デプロイ → Pages デプロイ → `/api/*` の疎通確認 |
| `.github/workflows/deploy-staging.yml` | `main` 以外への push / 手動実行 | `environment: staging`、Worker は `--env staging`、Pages は `regional-quiz-frontend-staging` |
| `.github/workflows/deploy-production.yml` | `main` への push / 手動実行 | `environment: production`、Worker は `--env production`、Pages は `regional-quiz-frontend`。適用前に `db push --linked --dry-run` で差分をログに残す |

呼び出し側は `secrets: inherit` を使うため、Secrets の参照先は呼び出し先ジョブの `environment:` で決まります。押さえておきたい点は次の通りです。

- **マイグレーションは両 Cloudflare デプロイより前**。逆順にすると、2 ステップの間のリクエストが「まだ存在しない列」を引く新しい Worker に当たります。
- **デプロイは cancel されない**。`concurrency` は環境ごとにキューイングする設定(`cancel-in-progress: false`)です。マイグレーション適用後に kill されると、スキーマだけが先行した状態が残るためです。
- **typecheck / test を再実行する**。`ci.yml` の結果でこのワークフローを gate していないので、`ci.yml` を信用せずに自前で再確認します。lint は落としても本番を止める理由にはならないため再実行しません。
- **Supabase CLI は `bunx supabase`**(ルートの devDependency)。本番に触れる CLI を `bun.lock` の 1 箇所で固定するためで、`ci.yml` の e2e ジョブが `supabase/setup-cli` を使っているのとは意図的に異なります。
- **シークレットはデプロイで配布されない**。Worker / Pages のシークレットは 6.2・6.3 で一度登録するだけで、ワークフローは触りません。
- **`/api/*` の route はワークフローが付ける**。`wrangler.toml` に `routes` は書かず、Environment 変数 `FRONTEND_HOST` から `--route` を組み立てます。アカウントが持たないゾーンを `wrangler.toml` に書くと `wrangler deploy` 自体が落ちるためで、実ドメインの有効化をコード変更なしの設定変更で済ませる狙いもあります(6.4)。
- **最後に `/api/*` の疎通を確認する**。route はデプロイが成功しても効いていないことがあり、その場合ページは描画されるのにブラウザからの API 呼び出しだけが 404 になります。`FRONTEND_HOST` のオリジンで `/api/healthz` を叩き、返らなければデプロイを失敗させます。
- **フロントエンドのビルドはマイグレーションより前**。`ci.yml` は typecheck/lint/test/e2e までで `build` を実行しないため、`vite build` が初めて走るのはこのジョブです。Pages アップロードの直前に置くと、ビルド失敗が「マイグレーション適用済み・新 Worker 適用済み・フロントエンドだけ古い」状態を残すので、typecheck / test と並べて前倒ししています。

再デプロイが必要になった場合は、対象ワークフローを `workflow_dispatch` から再実行してください。`supabase db push` は適用済みマイグレーションを飛ばすため、Cloudflare 側だけが失敗したケースはワークフロー全体の再実行で回復できます。

## 8. デプロイ後の確認

- `GET https://<worker-domain>/api/healthz` が `{ "ok": true }` を返すこと(Hono 側が `basePath('/api')` なので `/healthz` 単体は 404 になる)
- フロントエンドのトップページが表示され、`hc<AppType>()` 経由の API 呼び出しが疎通すること。フロントエンドのオリジンで `/api/healthz` が返るかどうかが、6.4 の Worker route が効いているかの確認になる(`FRONTEND_HOST` を設定していればワークフローの最後のステップが自動で確認する)
- **ブラウザから直接叩く API** が疎通すること。SSR は route が無くても `handleFetch` で通ってしまうため、ここだけは別に確認する。スタッフ管理画面のエントリー一覧から CSV ダウンロードのリンクを踏んでファイルが落ちること、`/admin/tournaments/new` から大会を作成できること
- GitHub Actions の該当ワークフローが全ステップ成功していること
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
- [ ] 各 Worker 環境に `wrangler secret put` でシークレットを登録した(6.2)
- [ ] 環境ごとに Turnstile widget を作成し、Secret Key を Worker に登録した(6.2)
- [ ] 一斉メール用の Queue と dead letter queue を環境ごとに作成した(6.2.2。Workers Paid プランが要る)
- [ ] Pages プロジェクトを production branch `main` で作成した(6.3)
- [ ] Pages プロジェクトに `BACKEND_URL` / `SESSION_SECRET` / `PUBLIC_TURNSTILE_SITE_KEY` を登録した(6.3)
- [ ] ドメインを取得し、Cloudflare のゾーンに追加した(6.4)
- [ ] Pages プロジェクト(production / staging)にカスタムドメインを割り当てた(6.3 / 6.4)
- [ ] GitHub の各 Environment に `FRONTEND_HOST` 変数を登録し、`/api/*` が Worker に届くことを確認した(6.4 / 6.5 / #101)
- [ ] `wrangler.toml` の `[env.*.vars]` の `MAIL_FROM_ADDRESS` をプレースホルダから実ドメインに差し替えた(6.4)
- [ ] `bunx supabase db push --linked --dry-run` で初回マイグレーション適用の差分を確認した
- [ ] staging の `deploy-staging` ワークフローが全ステップ成功することを確認した
- [ ] production への初回デプロイ後、`/api/healthz` とトップページの疎通を確認した

## 11. 参考リンク

- Supabase CLI Local Development: https://supabase.com/docs/guides/local-development
- Supabase CLI Managing Environments: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase CLI コマンドリファレンス: https://supabase.com/docs/reference/cli
- Wrangler Environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Wrangler Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Pages デプロイ(Wrangler 経由): https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
