# Supabase デプロイ手順書(テスト環境・本番環境)

このドキュメントは、`supabase/migrations/` で管理しているスキーマを Supabase のテスト環境(staging)・本番環境(production)へ適用し、`apps/backend`(Cloudflare Workers)・`apps/frontend`(Cloudflare Pages)と接続するまでの手順をまとめたものです。

> **前提**: パイプライン側(`.github/workflows/deploy*.yml`、`apps/backend/wrangler.toml` の環境定義)は Task 8-2(#42)で実装済みです。staging は 2026-10-22 に本ドキュメントの手順で構築し、初回デプロイが通っています(その記録と、つまずいた点は [`staging-setup-walkthrough.md`](./staging-setup-walkthrough.md))。production の Supabase / Cloudflare の実体と GitHub Environment の Secrets はまだ作成されておらず、作成が済むまで `deploy-production` はシークレット未設定で失敗します。

## 1. 環境の全体像

| 環境 | Supabase プロジェクト | 用途 | マイグレーション適用方法 | 接続先 |
| --- | --- | --- | --- | --- |
| ローカル | Supabase CLI のローカルスタック(Docker) | 開発・単体/統合テスト | `bun run db:migrate`(= `supabase db push --local`) | `apps/backend` はローカル Supabase(`http://127.0.0.1:54321`) |
| テスト環境(staging、dev 環境) | 専用の Supabase プロジェクト(例: `regional-quiz-entry-form-staging`) | `develop` に入った変更の動作確認・本番反映前の最終確認 | `develop` マージ時に GitHub Actions から `supabase db push --linked` | Cloudflare Workers/Pages の staging 環境 |
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
5. 以下を控える(Cloudflare Workers のシークレットに使う)
   - **Project URL** → `SUPABASE_URL`。ダッシュボード上部の **Connect** ダイアログに表示される(形式は `https://<project ref>.supabase.co`)。旧来の `Project Settings > API` ページは廃止されている
   - **Secret key**(`sb_secret_...`)→ `SUPABASE_SECRET_KEY`。`Project Settings > API Keys` の Secret keys セクションで発行・コピーする(**絶対にフロントエンドや公開リポジトリに含めない**)

> **API キーについて**: Supabase の API キーは publishable key(`sb_publishable_...`)/ secret key(`sb_secret_...`)の新方式に移行しており、従来の `anon` / `service_role` キー(JWT 形式、`eyJ...`)は legacy 扱いで 2026 年末までに廃止予定です。新規環境では legacy キーを使わず secret key を登録してください。
>
> - secret key は legacy の `service_role` と同じく `service_role` ロールにマッピングされ、RLS をバイパスします。バックエンドが必要とする権限は変わりません。`@supabase/supabase-js` の `createClient(url, key)` にそのまま渡せるため、`apps/backend/src/lib/db.ts` の変更は不要です。
> - Worker の binding 名は `SUPABASE_SECRET_KEY` です(旧名は `SUPABASE_SERVICE_ROLE_KEY`)。旧名でシークレットを登録済みの環境では、名前変更を含むコードをデプロイする**前に** `wrangler secret put SUPABASE_SECRET_KEY --env <name>` で新しい名前に登録してください。未登録のままデプロイすると Supabase に接続できなくなります。デプロイ後、不要になった旧名は `wrangler secret delete SUPABASE_SERVICE_ROLE_KEY --env <name>` で削除します。
> - secret key は User-Agent がブラウザのリクエストを 401 で拒否します。Workers からのサーバー間通信は対象外ですが、誤ってフロントエンドに露出させない理由は変わりません。
> - publishable key はこのプロジェクトでは使いません(フロントエンドは Supabase を直接呼ばず、すべて `apps/backend` の Hono API を経由するため)。
> - secret key はいくつでも発行できるので、staging / production で別々の key を使い、漏洩時は「新しい key を発行 → Worker のシークレットを差し替え → 古い key を削除」の順でローテーションします(削除は取り消せないため、差し替えの確認が済んでから行う)。
> - 新しいキーを発行しても legacy キーは自動では無効化されません。secret key への切り替えを確認したら、`Project Settings > API Keys` の Legacy API Keys で `anon` / `service_role` を無効化してください。

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

`db push` は、リモートに適用済みの最後のマイグレーションより古いタイムスタンプのファイルを見つけると `Found local migration files to be inserted before the last migration on remote database` で停止します。staging は `develop` に入る全ブランチが共有するため、これは起こり得ます — ブランチ A(新しいマイグレーション)が先に `develop` にマージされて staging にデプロイされた後、ブランチ B(古いマイグレーション)をマージすると、B の staging デプロイがここで落ちます。`workflow_dispatch` で未マージのブランチを staging に手動デプロイした場合も同様です。

順序の入れ替わりが意図通りであれば `--include-all` を付けて適用します。意図通りでない(= 実際に順序依存がある)場合は、マイグレーションファイルを rebase してタイムスタンプを振り直してください。**production で `--include-all` に頼るのは避け、production に到達する前に staging で解消しておきます。**

## 6. 環境変数・シークレット管理

### 6.1 Supabase 側の値

| 名前 | 用途 | 発行元 |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | CI からの `link` / `db push --linked` に使用する Personal Access Token(環境ごとにスコープを絞って発行する。6.5 参照) | Supabase Dashboard > Account > Access Tokens |
| `SUPABASE_URL` | `@supabase/supabase-js` の接続先(環境ごとに異なる) | 各プロジェクトのダッシュボードの **Connect** ダイアログ(`https://<project ref>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | バックエンドが RLS をバイパスして操作するための **secret key**(`sb_secret_...`、環境ごとに異なる) | 各プロジェクトの `Project Settings > API Keys` の Secret keys |
| `SUPABASE_DB_PASSWORD` | `link` / `db push --linked` が Postgres へ接続するためのパスワード(環境ごとに異なる) | プロジェクト作成時に生成した DB パスワード |

登録先は値によって分かれます。`SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD`(と `SUPABASE_PROJECT_ID`)は CI が使うので **GitHub Environment の Secrets**(6.5)に、`SUPABASE_URL` / `SUPABASE_SECRET_KEY` は Worker が実行時に読むので **Worker のシークレット**(6.2)に登録します。後者を GitHub の Secrets に入れても、ワークフローはどこからも参照しないので Worker には届きません。

### 6.2 Cloudflare Workers(`apps/backend`)側

`apps/backend/wrangler.toml` に `staging` / `production` の 2 環境を定義済みです。実ファイルを参照してください。編集する際の注意点は 2 つです。

- **`vars` と `routes` は環境に継承されない**。`[env.staging]` に `[env.staging.vars]` を書かないと、トップレベルの `[vars]` ではなく「vars なし」でデプロイされます(Wrangler の non-inheritable key)。そのため両環境がそれぞれ自分の `vars` を持っており、トップレベルの `[vars]` は `wrangler dev`(無名環境)専用です。
- **`[env.production]` で `name` を上書きしている**。`--env production` はデフォルトで Worker 名に `-production` を付けるため、明示しないと `regional-quiz-backend-production` にデプロイされます。

各環境に対して、`apps/backend/src/types/env.ts` の `Bindings` のうち機密であるものをシークレットとして登録します(`MAIL_FROM_ADDRESS` / `FRONTEND_URL` は `wrangler.toml` の `vars` 側なので不要)。

```bash
cd apps/backend

# staging
bunx wrangler secret put SUPABASE_URL --env staging
bunx wrangler secret put SUPABASE_SECRET_KEY --env staging
bunx wrangler secret put MAIL_API_KEY --env staging
bunx wrangler secret put GOOGLE_SHEETS_API_KEY --env staging
bunx wrangler secret put SESSION_SECRET --env staging
bunx wrangler secret put TURNSTILE_SECRET_KEY --env staging

# production
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_SECRET_KEY --env production
bunx wrangler secret put MAIL_API_KEY --env production
bunx wrangler secret put GOOGLE_SHEETS_API_KEY --env production
bunx wrangler secret put SESSION_SECRET --env production
bunx wrangler secret put TURNSTILE_SECRET_KEY --env production
```

`SESSION_SECRET` は staging/production で必ず異なる値を発行してください(`openssl rand -base64 32` などで生成)。6.3 で Pages にも同じ値を登録するので、シークレット管理ツールに保存しておきます。シークレットは `wrangler deploy` では変更されないため、この登録は環境ごとに一度だけで済みます。

初回デプロイ前は Worker がまだ存在しないため、最初の `secret put` で `There doesn't seem to be a Worker called "..."` と聞かれます。**Yes** と答えると空の Worker が作られ、そこにシークレットが登録されます。`MAIL_API_KEY` / `GOOGLE_SHEETS_API_KEY` は未登録でもデプロイ自体は通り、その機能(メール送信・シート取り込み)が実行時に失敗するだけなので、用意できてから登録しても構いません。

`TURNSTILE_SECRET_KEY` は Cloudflare Dashboard の `Turnstile` で widget を作成すると発行される **Secret Key** です(#116)。ウィジェットは環境ごとに 1 つ作り、その **Site Key** を Pages 側の `PUBLIC_TURNSTILE_SITE_KEY`(6.3)に、Secret Key をここに登録します。widget のドメイン設定には、その環境でフォームを表示するホスト名を入れてください。独自ドメインが無い間は Pages の既定ホスト名(例: `regional-quiz-frontend-staging.pages.dev`)を入れ、6.4 でカスタムドメインを割り当てたときに追加します。

> **`[env.*.vars]` に `TURNSTILE_SECRET_KEY` を書かないでください。** 同名の var があるとデプロイのたびにシークレットが平文の var で上書きされます。トップレベルの `[vars]` にはローカル開発用のテスト鍵(Cloudflare が公開している「常に成功する」固定値)が入っていますが、`vars` は環境に継承されないため `--env` 付きのデプロイには影響しません。
>
> このため `wrangler deploy --env <name>` は毎回 `"vars.TURNSTILE_SECRET_KEY" exists at the top level, but not on "env.<name>.vars"` と警告します。**想定どおりの警告で、指示どおりに追記してはいけません。**

### 6.2.1 レート制限の binding

`wrangler.toml` の各環境に `LOGIN_IP_RATE_LIMITER` / `LOGIN_EMAIL_RATE_LIMITER` / `MAIL_TRIGGER_IP_RATE_LIMITER` / `MAIL_TRIGGER_EMAIL_RATE_LIMITER`(Cloudflare の Rate Limiting binding)を定義済みです(#116)。**登録作業は不要**で、`namespace_id` は Cloudflare 側の資源を指すものではなく「どのカウンタか」を表すだけの識別子です。ただし環境をまたいで同じ id を使うと staging の負荷が production の枠を食うため、`wrangler.toml` では環境ごとに別の値にしてあります。ここを編集するときは、`period` に **10 か 60 しか指定できない**点にも注意してください。

### 6.2.2 一斉メール用の Queue

スタッフの一斉メールは Cloudflare Queues のコンシューマが送ります(Task 10-4 / #114)。`wrangler.toml` の各環境に producer(`BULK_MAIL_QUEUE`)と consumer を定義済みですが、**キューそのものは先に作っておく必要があります**。存在しないキュー名を指す `wrangler deploy` は失敗します。

> **Queues は Workers Free プランでも使えます**(2026-02 以降)。ただし Free プランは操作数が 1 日 10,000 回(読み取り・書き込み・削除の合計)まで、メッセージの保持期間が**最大 24 時間**(Paid は 14 日)に制限されます。Wrangler の既定の保持期間は 4 日(345600 秒)なので、Free プランでは下記のように `--message-retention-period-secs 86400` を明示してください。Paid プランでもこの指定のままで問題ありません。ローカル開発と E2E は `wrangler dev` がキューを模擬するので、どちらのプランでも課金は要りません。

環境ごとに本体と dead letter queue の 2 本ずつ作ります(名前は `wrangler.toml` の `queue` / `dead_letter_queue` と一致させてください)。

```bash
cd apps/backend

# staging
bunx wrangler queues create regional-quiz-bulk-mail-staging --message-retention-period-secs 86400
bunx wrangler queues create regional-quiz-bulk-mail-staging-dlq --message-retention-period-secs 86400

# production
bunx wrangler queues create regional-quiz-bulk-mail --message-retention-period-secs 86400
bunx wrangler queues create regional-quiz-bulk-mail-dlq --message-retention-period-secs 86400
```

1 日 10,000 回の操作数は、一斉メール 1 通あたり送信・受信・確認応答で数回ずつ消費します。production で大会規模の一斉メールを送るなら、上限に収まるかを見積もるか Paid プランを検討してください。

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
| `BACKEND_URL` | 通常の変数 | その環境のバックエンド Worker のオリジン(例: `https://entry.regionalquiz.example`)。SSR の `handleFetch` が `/api/*` の転送先に使う。末尾の `/` や `/api` は付けない。独自ドメインが無い間は workers.dev の URL(`https://regional-quiz-backend-staging.<アカウントのサブドメイン>.workers.dev`)を入れる |
| `SESSION_SECRET` | シークレット | **同じ環境の Worker に登録したものと同一の値**。ズレるとログイン直後のセッションが読めず `/staff/*` がログイン画面に跳ね返される |
| `PUBLIC_TURNSTILE_SITE_KEY` | 通常の変数 | 6.2 で作成した Turnstile widget の **Site Key**。エントリーフォームとパスワード再設定要求フォームのウィジェットが読む。未設定だとウィジェットが描画されず、トークンが無い送信をバックエンドが 400 で拒否するため、**この 2 つのフォームが誰にも使えなくなる** |

```bash
# staging
bunx wrangler pages secret put SESSION_SECRET --project-name regional-quiz-frontend-staging

# production
bunx wrangler pages secret put SESSION_SECRET --project-name regional-quiz-frontend
```

`BACKEND_URL` / `PUBLIC_TURNSTILE_SITE_KEY` は機密ではないので、Dashboard の `Settings > Variables and Secrets` から登録します。このとき環境は **Production** を選んでください(ワークフローは `--branch main` でアップロードするため、デプロイは Pages の production 環境として扱われます。Preview 側に登録しても読まれません)。いずれも Pages プロジェクト側の設定で、`wrangler pages deploy` では上書きされません。

`<アカウントのサブドメイン>` は Dashboard の `Workers & Pages` の右側に表示される `Subdomain`(`xxx.workers.dev`)で確認できます。

### 6.4 `/api/*` をバックエンド Worker へ振り分ける

フロントエンドは同一オリジンの `/api/*` を叩きます(`apps/frontend/src/lib/api.ts`)。`apps/frontend` 側にこれを転送する仕組みはなく、`vite.config.ts` の proxy は `vite dev` 専用です。本番でこれを担うのが **Worker route** です。同一ホスト名に対して Workers route は Pages プロジェクトより優先されるため、`/api/*` だけが Hono に届き、それ以外は Pages が返します。

`apps/backend/wrangler.toml` の各環境にコメントアウト済みの `routes` があるので、実ドメインを入れて有効化してください。

```toml
[env.production]
name = "regional-quiz-backend"
routes = [
  {pattern = "entry.regionalquiz.example/api/*", zone_name = "regionalquiz.example"},
]
```

`routes` は `[env.*]` の**直下**に書いてください。`[env.*.vars]` の下に置くと `routes` という名前の var として解釈され、警告もエラーも出ないまま route 無しでデプロイされます。

> 現状は `regionalquiz.example` がプレースホルダのためコメントアウトしています。Cloudflare アカウントが持っていない `zone_name` を書くと `wrangler deploy` 自体が失敗するため、**ドメインを取得して Pages にカスタムドメインを割り当てるまでは有効化しないでください**。有効化するまでは、デプロイされたフロントエンドからブラウザ経由の API 呼び出し(CSV ダウンロードのリンク、クライアント側の `createApiClient()`)は 404 になります。この残作業は **#101** で追跡しています。

### 6.5 GitHub Actions 側

リポジトリの `Settings > Environments` に `staging` と `production` の2つの Environment を作成し、それぞれに以下の Secrets を登録します。production 環境には **Required reviewers** を設定し、本番デプロイ前に人手のレビューを挟むことを推奨します(`deploy-production.yml` は最初のステップの前で承認待ちになります)。

| Secret 名 | staging | production |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | staging プロジェクトだけにスコープを絞ったトークン | production プロジェクトだけにスコープを絞ったトークン |
| `SUPABASE_PROJECT_ID` | staging プロジェクトの project ref | production プロジェクトの project ref |
| `SUPABASE_DB_PASSWORD` | staging プロジェクト作成時の DB パスワード | production プロジェクトの DB パスワード |
| `CLOUDFLARE_API_TOKEN` | 下記の権限を持つ Custom Token | 同左 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID(`Workers & Pages` の右側に表示) | 同左 |

`SUPABASE_DB_PASSWORD` は `supabase link` / `supabase db push --linked` が DB へ接続するのに使います。未登録だと CI は対話プロンプトを出せずに失敗します。

#### `SUPABASE_ACCESS_TOKEN` の発行

Supabase の Personal Access Token は、プロジェクトと機能ごとにスコープを絞って発行できます(2026-10 に GA)。アカウント全体に効く「Create legacy token」は使わず、**環境ごとに対象プロジェクト 1 つに絞ったトークン**を発行してください。こうしておくと、staging のトークンが漏れても production には届きません。

- 対象: その環境のプロジェクトだけ
- 権限: projects = read、database = read-write、**API keys(`api_gateway_keys_read`)= read**。`supabase link` はプロジェクトの API キー情報を読むため、最後の権限が無いと `Missing required permission(s): api_gateway_keys_read` で失敗します。auth / storage などは不要です
- 有効期限: 最長 1 年。期限日を記録しておく

スコープ付きトークンは作成後に権限を変更できません。権限が足りなかった場合は作り直して Secret を上書きし、デプロイが通ってから古いトークンを削除します。

#### `CLOUDFLARE_API_TOKEN` の発行

`My Profile > API Tokens > Create Token > Custom token` で作成します(テンプレートの「Edit Cloudflare Workers」は Pages の権限が無く、不要な権限を含むので使いません)。値は作成直後の画面に一度だけ表示されます。控え損ねたら一覧の「…」から **Roll** で再発行します。

| 区分 | 権限 | レベル |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Cloudflare Pages | Edit |
| Account | Queues | Edit |
| Account | Account Settings | Read |
| User | Memberships | Read |
| User | User Details | Read |

- Account Resources は対象アカウント 1 つに限定する
- Zone の権限(`Workers Routes: Edit`)は 6.4 で `routes` を有効化するときに必要になる。その時点でトークンを作り直す
- GitHub のランナーは IP が固定されないので、Client IP Address Filtering は設定しない

Cloudflare のトークンは Worker 単位では絞れないため、staging と production が同じアカウントにある限り、トークンを環境ごとに分けても分離の効果は小さいです。厳密に分けるならアカウント自体を分けます。

## 7. CI/CD パイプライン

`ci.yml`(typecheck/lint/test/e2e)に加えて、デプロイ用に 3 ファイルを置いています。ステップ構成が staging と production でほぼ同一なため、実体は `workflow_call` の再利用ワークフロー 1 つで、呼び出し側は環境ごとの差分だけを渡します。

| ファイル | トリガー | 役割 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | `workflow_call` | 実体。checkout → `bun install` → typecheck/test → Supabase link → マイグレーション適用 → Worker デプロイ → フロントエンドのビルド → Pages デプロイ |
| `.github/workflows/deploy-staging.yml` | `develop` への push / 手動実行(任意のブランチを指定可) | `environment: staging`、Worker は `--env staging`、Pages は `regional-quiz-frontend-staging` |
| `.github/workflows/deploy-production.yml` | `main` への push / 手動実行 | `environment: production`、Worker は `--env production`、Pages は `regional-quiz-frontend`。適用前に `db push --linked --dry-run` で差分をログに残す |

ブランチ運用は次の通りです。

- 機能ブランチは `develop` から切り、PR は `develop` 向けに出す。マージすると staging(dev 環境)にデプロイされる
- リリース時は `develop` → `main` の PR を出してマージする。マージすると production にデプロイされる
- 機能ブランチへの push 自体ではデプロイされない。マージ前に実環境で確認したい場合は、`deploy-staging` を `workflow_dispatch` でそのブランチを指定して実行する(次に `develop` へ push されるまで staging はそのブランチの内容になる)
- `ci.yml` は PR と、`develop` / `main` への push で実行される

呼び出し側は `secrets: inherit` を使うため、Secrets の参照先は呼び出し先ジョブの `environment:` で決まります。押さえておきたい点は次の通りです。

- **マイグレーションは両 Cloudflare デプロイより前**。逆順にすると、2 ステップの間のリクエストが「まだ存在しない列」を引く新しい Worker に当たります。
- **デプロイは cancel されない**。`concurrency` は環境ごとにキューイングする設定(`cancel-in-progress: false`)です。マイグレーション適用後に kill されると、スキーマだけが先行した状態が残るためです。
- **typecheck / test を再実行する**。`ci.yml` の結果でこのワークフローを gate していないので、`ci.yml` を信用せずに自前で再確認します。lint は落としても本番を止める理由にはならないため再実行しません。
- **Supabase CLI は `bunx supabase`**(ルートの devDependency)。本番に触れる CLI を `bun.lock` の 1 箇所で固定するためで、`ci.yml` の e2e ジョブが `supabase/setup-cli` を使っているのとは意図的に異なります。
- **シークレットはデプロイで配布されない**。Worker / Pages のシークレットは 6.2・6.3 で一度登録するだけで、ワークフローは触りません。
- **フロントエンドのビルドはマイグレーションより前**。`ci.yml` は typecheck/lint/test/e2e までで `build` を実行しないため、`vite build` が初めて走るのはこのジョブです。Pages アップロードの直前に置くと、ビルド失敗が「マイグレーション適用済み・新 Worker 適用済み・フロントエンドだけ古い」状態を残すので、typecheck / test と並べて前倒ししています。

再デプロイが必要になった場合は、対象ワークフローを `workflow_dispatch` から再実行してください。`supabase db push` は適用済みマイグレーションを飛ばすため、Cloudflare 側だけが失敗したケースはワークフロー全体の再実行で回復できます。

## 8. デプロイ後の確認

- `GET https://<worker-domain>/api/healthz` が `{ "ok": true }` を返すこと(Hono 側が `basePath('/api')` なので `/healthz` 単体は 404 になる)
- フロントエンドのトップページが表示され、`hc<AppType>()` 経由の API 呼び出しが疎通すること。フロントエンドのオリジンで `/api/healthz` が返るかどうかが、6.4 の Worker route が効いているかの確認になる
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
- [ ] `SUPABASE_URL`(Connect ダイアログの Project URL)/ `SUPABASE_SECRET_KEY`(`Project Settings > API Keys` で発行した secret key)を控えた
- [ ] secret key で疎通を確認した後、Legacy API Keys(`anon` / `service_role`)を無効化した
- [ ] `Project Settings > General` の project ref を控えた
- [ ] `SESSION_SECRET` を環境ごとに個別発行した
- [ ] GitHub の `staging` / `production` Environments を作成し、Secrets を登録した
- [ ] `SUPABASE_ACCESS_TOKEN` を環境ごとに対象プロジェクトへスコープを絞って発行した(6.5。`api_gateway_keys_read` を含める)
- [ ] production Environment に Required reviewers を設定した
- [ ] 各 Worker 環境に `wrangler secret put` でシークレットを登録した(6.2)
- [ ] 環境ごとに Turnstile widget を作成し、Secret Key を Worker に登録した(6.2)
- [ ] 一斉メール用の Queue と dead letter queue を環境ごとに作成した(6.2.2。Free プランでは保持期間 24 時間を指定)
- [ ] Pages プロジェクトを production branch `main` で作成した(6.3)
- [ ] Pages プロジェクトの **Production** 環境に `BACKEND_URL` / `SESSION_SECRET` / `PUBLIC_TURNSTILE_SITE_KEY` を登録した(6.3)
- [ ] `wrangler.toml` の `routes` を実ドメインで有効化し、`/api/*` が Worker に届くことを確認した(6.4 / #101)
- [ ] `bunx supabase db push --linked --dry-run` で初回マイグレーション適用の差分を確認した
- [ ] staging の `deploy-staging` ワークフローが全ステップ成功することを確認した
- [ ] production への初回デプロイ後、`/api/healthz` とトップページの疎通を確認した

## 11. 参考リンク

- Supabase CLI Local Development: https://supabase.com/docs/guides/local-development
- Supabase API keys(publishable / secret key): https://supabase.com/docs/guides/api/api-keys
- Supabase スコープ付き Personal Access Token: https://supabase.com/changelog/scoped-personal-access-tokens-ga
- Cloudflare Queues の Free プラン対応: https://developers.cloudflare.com/changelog/product/queues/
- Supabase CLI Managing Environments: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase CLI コマンドリファレンス: https://supabase.com/docs/reference/cli
- Wrangler Environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Wrangler Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Pages デプロイ(Wrangler 経由): https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
