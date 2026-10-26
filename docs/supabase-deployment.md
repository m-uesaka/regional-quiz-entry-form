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

### 5.2 入力長の上限を張る前の確認

`0021_entry_text_length_limits.sql` は `entries` の文字列項目に長さの check 制約(`entries_text_lengths`)を張ります(#122)。それ以前の行は上限なしで書かれているため、超えている行が 1 件でもあるとマイグレーションは件数と項目名を添えて失敗し、デプロイが止まります。`not valid` で既存行を見逃さないのは、見逃した行がエントリー編集で値をそのまま書き戻しただけで制約にかかり、参加者に 500 として見えるためです。

**このマイグレーションを含むリリースを staging / production に流す前に**、それぞれのプロジェクトの SQL Editor で次を実行し、0 件であることを確認してください(改行は CRLF で保存されている場合 1 つにつき 2 文字と数えられます)。

```sql
select id,
       char_length(name) as name,
       char_length(furigana) as furigana,
       char_length(display_name) as display_name,
       char_length(free_text) as free_text
from entries
where char_length(name) > 100
   or char_length(furigana) > 100
   or char_length(display_name) > 100
   or char_length(free_text) > 2000;
```

`custom_field_values`(回答の合計 10000 文字)はマイグレーションが作る関数で数えるため、事前には次で確認します。

```sql
select e.id, sum(char_length(v.element)) as total
from entries e
cross join lateral jsonb_each(e.custom_field_values) as f (key, value)
cross join lateral jsonb_array_elements_text(
  case jsonb_typeof(f.value) when 'array' then f.value else jsonb_build_array(f.value) end
) as v (element)
group by e.id
having sum(char_length(v.element)) > 10000;
```

該当行があれば、参加者・地域スタッフと相談のうえ値を短くしてから(CRLF は `replace(free_text, E'\r\n', E'\n')` で 1 文字にできます)デプロイしてください。

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
bunx wrangler secret put CLIENT_IP_FORWARD_SECRET --env staging

# production
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_SECRET_KEY --env production
bunx wrangler secret put MAIL_API_KEY --env production
bunx wrangler secret put GOOGLE_SHEETS_API_KEY --env production
bunx wrangler secret put SESSION_SECRET --env production
bunx wrangler secret put TURNSTILE_SECRET_KEY --env production
bunx wrangler secret put CLIENT_IP_FORWARD_SECRET --env production
```

`SESSION_SECRET` は staging/production で必ず異なる値を発行してください。6.3 で Pages にも同じ値を登録するので、シークレット管理ツールに保存しておきます。

**Worker と Pages に同じ値を入れる際は、手で打ち直さずクリップボード経由で貼り付けてください。** 登録した値は `secret list` でも名前しか表示されないので、後から両者が一致しているかを確かめる方法がありません。食い違うと、ログインは成功するのに `/staff/*` がログイン画面へ戻されます(6.3 の表)。一致しているか自信がないときは、値を作り直して両方に登録し直すのが確実です。

```bash
openssl rand -base64 32 | pbcopy   # 生成した値を画面に出さずクリップボードへ
bunx wrangler secret put SESSION_SECRET --env staging      # ⌘V
cd ../frontend
bunx wrangler pages secret put SESSION_SECRET --project-name regional-quiz-frontend-staging   # ⌘V
pbcopy < /dev/null                 # クリップボードを空にする
```

Pages 側の値は次のデプロイから反映されるため、登録し直した後は Pages を再デプロイします(`gh workflow run deploy-staging.yml --ref develop`)。Worker 側は再デプロイ不要です。値を変えると発行済みのセッションはすべて無効になり、スタッフも参加者もログインし直しになります。シークレットは `wrangler deploy` では変更されないため、この登録は環境ごとに一度だけで済みます。

初回デプロイ前は Worker がまだ存在しないため、最初の `secret put` で `There doesn't seem to be a Worker called "..."` と聞かれます。**Yes** と答えると空の Worker が作られ、そこにシークレットが登録されます。`MAIL_API_KEY` / `GOOGLE_SHEETS_API_KEY` は未登録でもデプロイ自体は通り、その機能(メール送信・シート取り込み)が実行時に失敗するだけなので、用意できてから登録しても構いません。

`TURNSTILE_SECRET_KEY` は Cloudflare Dashboard の `Turnstile` で widget を作成すると発行される **Secret Key** です(#116)。ウィジェットは環境ごとに 1 つ作り、その **Site Key** を Pages 側の `PUBLIC_TURNSTILE_SITE_KEY`(6.3)に、Secret Key をここに登録します。widget のドメイン設定には、その環境でフォームを表示するホスト名を入れてください。カスタムドメイン(staging: `staging.regional-quiz-project.app`、production: `regional-quiz-project.app`。6.4)と Pages の既定ホスト名(例: `regional-quiz-frontend-staging.pages.dev`)の両方を入れておきます。カスタムドメインが入っていないと、そのホストのフォームでウィジェットがエラーになります。

> **`[env.*.vars]` に `TURNSTILE_SECRET_KEY` を書かないでください。** 同名の var があるとデプロイのたびにシークレットが平文の var で上書きされます。トップレベルの `[vars]` にはローカル開発用のテスト鍵(Cloudflare が公開している「常に成功する」固定値)が入っていますが、`vars` は環境に継承されないため `--env` 付きのデプロイには影響しません。
>
> このため `wrangler deploy --env <name>` は毎回 `"vars.TURNSTILE_SECRET_KEY" exists at the top level, but not on "env.<name>.vars"` と警告します。**想定どおりの警告で、指示どおりに追記してはいけません。**

`CLIENT_IP_FORWARD_SECRET` は、フロントエンドが SSR から転送するリクエストに載せる利用者の IP(`X-Client-IP`)を、バックエンドが信用してよいかを判定する共有シークレットです(#188)。`SESSION_SECRET` と同じく環境ごとに `openssl rand -base64 32` で発行し、**6.3 で Pages にも同じ値を登録します**(手順は上の `SESSION_SECRET` と同じくクリップボード経由で)。未登録でも動作はしますが、その場合ログイン・エントリー送信・パスワード再設定申請の IP 単位のレート制限が全利用者で 1 つのバケツを共有し、1 人が上限まで叩くと全員が 429 になります。値がずれている場合も同じ状態になり、エラーは出ません。確認方法は 6.2.1 を参照してください。

### 6.2.1 レート制限の binding

`wrangler.toml` の各環境に `LOGIN_IP_RATE_LIMITER` / `LOGIN_EMAIL_RATE_LIMITER` / `MAIL_TRIGGER_IP_RATE_LIMITER` / `MAIL_TRIGGER_EMAIL_RATE_LIMITER`(Cloudflare の Rate Limiting binding)を定義済みです(#116)。**登録作業は不要**で、`namespace_id` は Cloudflare 側の資源を指すものではなく「どのカウンタか」を表すだけの識別子です。ただし環境をまたいで同じ id を使うと staging の負荷が production の枠を食うため、`wrangler.toml` では環境ごとに別の値にしてあります。ここを編集するときは、`period` に **10 か 60 しか指定できない**点にも注意してください。

IP 鍵が利用者ごとに分かれているか(`CLIENT_IP_FORWARD_SECRET` が Worker と Pages で一致しているか)は、`cd apps/backend && bunx wrangler tail --env staging --format json` を流しながら、2 つの異なる回線(例: 自宅の回線とスマートフォンのモバイル回線)からフロントエンドのログイン画面でログインを試して確かめます。各イベントの `event.request.headers` の `x-client-ip` にそれぞれの回線のアドレスが入っていれば転送はされています(同じ `headers` に `x-client-ip-forward-secret` も載り得るので、この出力をそのまま共有しないでください)。シークレットの一致そのものはログに出ないので、確実に確かめるには片方の回線から 1 分以内にログインを 11 回失敗させ(`LOGIN_IP_RATE_LIMITER` は staging / production とも 10 回 / 60 秒)、429 になった直後にもう片方の回線からはログインできることを確認します。シークレットがずれていると、もう片方も 429 になります。

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

`src/hooks.server.ts` は `$env/dynamic/private` から 3 つの値を、`Turnstile.svelte` は `$env/dynamic/public` から 1 つを読むので、Pages プロジェクトの変数として登録します。

| 名前 | 種別 | 値 |
| --- | --- | --- |
| `BACKEND_URL` | 通常の変数 | **その環境のバックエンド Worker 自身のオリジン**。production は `https://regional-quiz-backend.<subdomain>.workers.dev`、staging は `https://regional-quiz-backend-staging.<subdomain>.workers.dev`(`<subdomain>` は Cloudflare アカウントごとの workers.dev サブドメイン)。SSR の `handleFetch` が `/api/*` の転送先に使う。**フロントエンドのホスト名ではない**(6.4)。末尾の `/` や `/api` は付けない |
| `SESSION_SECRET` | シークレット | **同じ環境の Worker に登録したものと同一の値**。ズレるとログイン直後のセッションが読めず `/staff/*` がログイン画面に跳ね返される |
| `CLIENT_IP_FORWARD_SECRET` | シークレット | **同じ環境の Worker に登録したものと同一の値**(6.2)。`handleFetch` が利用者の IP と一緒にバックエンドへ送る。未登録・不一致でも画面は動くが、IP 単位のレート制限が全利用者共通になる |
| `PUBLIC_TURNSTILE_SITE_KEY` | 通常の変数 | 6.2 で作成した Turnstile widget の **Site Key**。エントリーフォームとパスワード再設定要求フォームのウィジェットが読む。未設定だとウィジェットが描画されず、トークンが無い送信をバックエンドが 400 で拒否するため、**この 2 つのフォームが誰にも使えなくなる** |

```bash
cd apps/frontend

# staging
bunx wrangler pages secret put SESSION_SECRET --project-name regional-quiz-frontend-staging
bunx wrangler pages secret put BACKEND_URL --project-name regional-quiz-frontend-staging
bunx wrangler pages secret put PUBLIC_TURNSTILE_SITE_KEY --project-name regional-quiz-frontend-staging
bunx wrangler pages secret put CLIENT_IP_FORWARD_SECRET --project-name regional-quiz-frontend-staging

# production
bunx wrangler pages secret put SESSION_SECRET --project-name regional-quiz-frontend
bunx wrangler pages secret put BACKEND_URL --project-name regional-quiz-frontend
bunx wrangler pages secret put PUBLIC_TURNSTILE_SITE_KEY --project-name regional-quiz-frontend
bunx wrangler pages secret put CLIENT_IP_FORWARD_SECRET --project-name regional-quiz-frontend

# 確認(4 つ並べば OK)
bunx wrangler pages secret list --project-name <プロジェクト名>
```

`BACKEND_URL` / `PUBLIC_TURNSTILE_SITE_KEY` は機密ではありませんが、**すべて CLI(`pages secret put`)で登録してください**。表の「種別」は値の性質で、登録方法とは別です。

- `pages secret put` は Production 環境に暗号化された変数として登録します。ワークフローは `--branch main` でアップロードするので、デプロイは Pages の production 環境として扱われ、Preview 側の変数は読まれません。CLI ならこの取り違えが起きません
- 暗号化された変数も、SvelteKit からは `$env/dynamic/private` / `$env/dynamic/public` のどちらでも通常の変数と同じように読めます(`PUBLIC_` で始まる値はページに埋め込まれます)
- staging の構築時には、Dashboard から登録した 2 つが保存されておらず、`BACKEND_URL is not set` で SSR が 500 になりました。CLI なら `secret list` で登録できたかをその場で確かめられます

**Pages の変数は、登録した後のデプロイから反映されます。** 既存のデプロイには届かないので、変数を足したり直したりしたら、対象のワークフローを `workflow_dispatch` で再実行してください。Worker のシークレット(6.2)は登録した時点で反映されるので、ここが違います。いずれも Pages プロジェクト側の設定で、`wrangler pages deploy` では上書きされません。

`<アカウントのサブドメイン>` は Dashboard の `Workers & Pages` の右側に表示される `Subdomain`(`xxx.workers.dev`)で確認できます。

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

ドメインは Cloudflare Registrar で取得した `regional-quiz-project.app` で、環境ごとに次のように割り当てています。

| 環境 | `FRONTEND_HOST`(Pages のカスタムドメイン) | `MAIL_FROM_ADDRESS` |
| --- | --- | --- |
| staging | `staging.regional-quiz-project.app` | `no-reply@staging.mail.regional-quiz-project.app` |
| production | `regional-quiz-project.app` | `no-reply@mail.regional-quiz-project.app` |

1. ドメインを取得し、Cloudflare のゾーンに追加する
2. Pages プロジェクト(production / staging)にカスタムドメインを割り当てる(6.3)
3. GitHub の `staging` / `production` Environment に `FRONTEND_HOST` 変数を登録する(6.5)
4. Turnstile widget にカスタムドメインのホスト名を追加する(6.2)
5. Resend で送信用ドメイン(上表の `@` 以降)を検証し、`MAIL_API_KEY` を登録する(6.6)
6. デプロイし直す

Pages の `BACKEND_URL`(6.3)はここでは触りません。SSR の転送先は route ではなく Worker 自身のオリジン、つまり workers.dev のままで正しく、`wrangler.toml` の `workers_dev = true` がそれを維持します。ここで `BACKEND_URL` をフロントエンドのホスト名に書き換える必要はありません。

`FRONTEND_HOST` にはスキームもパスも付けず、**ホスト名だけ**を入れます(例: `entry.example.jp` / `staging.entry.example.jp`)。route のパターンと Pages のカスタムドメインは同一ホストでなければ意味がない(そのホストを Pages が持っているからこそ Workers route が優先される)ため、両者を別々の設定にせず 1 つの変数から導出しています。

`FRONTEND_URL` を同じ変数から上書きしているのも同じ理由です。これは `src/lib/entry-verification.ts` とパスワード再設定メールがリンクを組み立てる URL で、値がずれても**サイトは正常に見えます**。壊れるのはメール内のリンクだけなので、デプロイ時には誰も気づきません。`--var` は環境の vars を置き換えではなく**マージ**するので、`MAIL_FROM_ADDRESS` は `wrangler.toml` の値のまま、`wrangler secret put` で登録したシークレット(`TURNSTILE_SECRET_KEY` 等)もそのまま引き継がれます。

> `MAIL_FROM_ADDRESS` だけは `apps/backend/wrangler.toml` の `[env.*.vars]` を手で書き換えてください。送信元ドメインはメール事業者側で検証済みのドメインであって、サイトのホスト名とは限らないため、`FRONTEND_HOST` からは導出していません。現在は上表の `mail.` サブドメインのアドレスが入っています。

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
| `SUPABASE_ACCESS_TOKEN` | staging プロジェクトだけにスコープを絞ったトークン | production プロジェクトだけにスコープを絞ったトークン |
| `SUPABASE_PROJECT_ID` | staging プロジェクトの project ref | production プロジェクトの project ref |
| `SUPABASE_DB_PASSWORD` | staging プロジェクト作成時の DB パスワード | production プロジェクトの DB パスワード |
| `CLOUDFLARE_API_TOKEN` | 下記の権限を持つ Custom Token | 同左 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID(`Workers & Pages` の右側に表示) | 同左 |

`SUPABASE_DB_PASSWORD` は `supabase link` / `supabase db push --linked` が DB へ接続するのに使います。未登録だと CI は対話プロンプトを出せずに失敗します。

同じ Environment に、機密でない **Variables** も 1 つ登録します(`Settings > Environments > <環境> > Environment variables`。Secrets ではなく Variables 側です)。

| 変数名 | staging | production |
| --- | --- | --- |
| `FRONTEND_HOST` | `staging.regional-quiz-project.app` | `regional-quiz-project.app` |

スキームもパスも付けない**ホスト名のみ**です。`deploy.yml` はこれを使って Worker の `/api/*` route と `FRONTEND_URL` を組み立て、デプロイ後の疎通確認も行います(6.4)。**未設定でもデプロイは成功します**が、その場合 route が付かないため、ブラウザから直接叩く API がすべて 404 になります(ワークフローのログに warning が出ます)。

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
- Zone の権限(`Workers Routes: Edit`)は `FRONTEND_HOST` を登録して `/api/*` の route を付けるとき(6.4)に必要になる。その時点でトークンを作り直す
- GitHub のランナーは IP が固定されないので、Client IP Address Filtering は設定しない

Cloudflare のトークンは Worker 単位では絞れないため、staging と production が同じアカウントにある限り、トークンを環境ごとに分けても分離の効果は小さいです。厳密に分けるならアカウント自体を分けます。

### 6.6 メール送信(Resend)

参加者へのエントリー確認・パスワード再設定・繰り上げ当選の連絡、スタッフの招待、一斉メールは、すべて Resend(`apps/backend/src/lib/mailer.ts`)から送ります。関係する値は次の 3 つです。

| 名前 | 置き場所 | staging | production |
| --- | --- | --- | --- |
| `MAIL_FROM_ADDRESS` | `wrangler.toml` の `[env.*.vars]` | `no-reply@staging.mail.regional-quiz-project.app` | `no-reply@mail.regional-quiz-project.app` |
| `MAIL_API_KEY` | Worker のシークレット(6.2) | staging 用のキー | production 用のキー |
| `FRONTEND_URL` | `deploy.yml` が `FRONTEND_HOST` から設定する(6.4) | `https://staging.regional-quiz-project.app` | `https://regional-quiz-project.app` |

`MAIL_FROM_ADDRESS` のドメインが Resend で検証済みでないと、送信はすべて拒否されます。メール本文のリンクは `FRONTEND_URL` から組み立てます。

`FRONTEND_URL` は、バックエンドの Origin 検証(`hono/csrf`、#120)が状態変更リクエストを許すオリジンでもあります。フロントエンドを `FRONTEND_URL` 以外のオリジン(`FRONTEND_HOST` 未設定のまま `*.pages.dev` で開く等)で使うと、ログアウトやエントリー取消などのボディの無い POST/DELETE が 403 になります。詳細は [`api-endpoints.md`](./api-endpoints.md) の「CSRF 対策(Origin 検証)とセキュリティヘッダ」を参照してください。

#### プランとドメイン数

送信ドメインを環境ごとに分けているのは、staging での試験送信がバウンスや迷惑メール報告を招いても、production の送信ドメインの評判に影響させないためです。Resend の Free プランでも検証できるドメインは 3 つまでなので(2026-10 時点の公式料金表)、上の表のとおり 2 ドメインを Free プランのまま検証できます。

- 送信数の上限(Free プランは 1 日 100 通・月 3,000 通)はアカウント単位なので、同じアカウントで 2 ドメインを検証すると両環境で共有になる。一斉メールなどで足りなくなる場合は Pro 以上のプランにする
- プランの条件は変わることがあるので、ドメインを登録する前に https://resend.com/pricing で、ドメイン数と送信数の上限を確認する

#### 設定手順

以下は staging の例です。production では、ドメイン・キー名・`--env` を読み替えます。

1. **ドメインを追加する。** Resend の `Domains` → `Add Domain` を開く
   - Name: `staging.mail.regional-quiz-project.app`
   - Region: `Tokyo (ap-northeast-1)`
2. **DNS レコードを登録する。** 表示されたレコード(通常は DKIM の TXT `resend._domainkey.staging.mail`、バウンス用の MX `send.staging.mail`、SPF の TXT `send.staging.mail`)を、Cloudflare の `regional-quiz-project.app` ゾーンの `DNS > Records` に、表示どおりの名前・値・Priority で登録する。Resend の画面に Cloudflare との自動連携(Auto configure)が出ていれば、それを使ってもよい。TXT と MX はプロキシの対象外なので、プロキシの設定は不要。登録したら `Verify DNS Records` を押し、`Verified` になるのを待つ
3. **DMARC を追加する(推奨。環境で共通)。** Gmail などは DMARC の有無を見るため、ゾーンに 1 件だけ追加する

   | 種類 | 名前 | 内容 |
   | --- | --- | --- |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` |

4. **API キーを作る。** `API Keys` → `Create API Key` を開き、Permission を **Sending access** に、Domain を手順 1 のドメインに限定して作る(Name の例: `regional-quiz-staging`)。キー(`re_...`)は作成直後の画面にしか表示されない
5. **Worker に登録する。** 登録した時点で反映されるので、再デプロイは要らない

   ```bash
   cd apps/backend
   bunx wrangler secret put MAIL_API_KEY --env staging
   bunx wrangler secret list --env staging     # MAIL_API_KEY が並べば OK
   ```

#### 送信の確認

スタッフ用のパスワード再設定の申込フォームはありません。参加者用の `/password-reset` は、アカウントの無いアドレス宛てには何も送りません(メールアドレスの列挙を防ぐため)。そのため、最初の確認には**スタッフの招待**を使います。

1. 統括スタッフ(8.1)でログインし、`/admin/staff` から自分が受け取れる別のアドレスを招待する
2. 次を確かめる
   - メールが届く(迷惑メールフォルダも確認する)
   - 差出人が「地域クイズ最強位・新人王 エントリー」で、アドレスが `MAIL_FROM_ADDRESS` になっている(表示名は `src/lib/mailer.ts` の `MAIL_FROM_NAME` がコード側で付ける)
   - 本文のリンクが `https://<FRONTEND_HOST>/staff/password-reset?token=...` で、開くとパスワード設定画面が表示される
   - メールのソースで SPF / DKIM / DMARC が `PASS` になっている
3. 届かないときは、Resend の `Logs` で送信履歴を確認し、送信されていなければ `bunx wrangler tail --env staging` を実行した状態で、`/admin/staff` の一覧から手順 1 のアカウントの「パスワード設定メールを再送」を押して、Worker のエラーを確認する。送信に失敗してもアカウントは作成済みなので、同じアドレスを**もう一度招待しても 409 になるだけで、メールの送信までは進まない**

| 症状 | 原因 |
| --- | --- |
| Resend の `Logs` に記録が無く、Worker のログに `Failed to send mail: 401` が出る | `MAIL_API_KEY` の貼り間違い(Resend が API キーを拒否している) |
| Resend の `Logs` に記録が無く、Worker のログに `Failed to send mail: 403` が出る | キーの権限か送信元ドメインの問題。Worker は Resend のエラー本文を残さないので、原因は Resend 側で確かめる。`Domains` で `MAIL_FROM_ADDRESS` のドメインが `Verified` になっているか(手順 2 の DNS レコード)、`API Keys` でキーが `Sending access` かつ対象ドメインが `MAIL_FROM_ADDRESS` のドメインと一致しているかを確認する |
| `Logs` では `Delivered` なのに受信箱に無い | 迷惑メールフォルダに入っている。手順 3 の DMARC で改善することがある |
| 招待するとアカウントは作られるが、`500 {"error": "account created but ..."}` になる | 送信に失敗している(Resend が 401 / 403 を返しても、招待 API・再送 API の応答は常に 500 になる。Resend の応答コードは Worker のログ `failed to send the staff password setup mail`(招待時)/ `failed to send the staff password reset mail`(再送時)に続く `Failed to send mail: <status>` で確認する)。上の 2 行を確認したうえで、`/admin/staff` の一覧から「パスワード設定メールを再送」を押す(もう一度招待すると 409 になる) |

#### 一斉メールの送信ペース

一斉メールは `sendPacedMail()`(`apps/backend/src/lib/bulk-mail.ts`)の 1 回の呼び出しにつき最大 5 通/秒に抑えて送ります(`MAIL_BATCH_SIZE = 5` / `MAIL_BATCH_INTERVAL_MS = 1000`)。Resend の API のレート制限はチーム全体で共有されます。既定値は公式ドキュメントの Usage Limits(https://resend.com/docs/api-reference/rate-limit)では 10 リクエスト/秒とされていますが、変更されることがあるため、現在の値は Resend のダッシュボードとドキュメントで確認してください。上記の送信ペースは `sendPacedMail()` の呼び出し単位の制御にすぎないため、同じ Resend チームを使う staging と production の送信や、一斉メールと同時に送られる確認メール・パスワード再設定メールなどの合計が上限を超えると 429 が返ります。429 を受けた宛先は `Retry-After`(なければ指数バックオフ)に従って最大 3 回まで再試行され、それでも送れなければキューに戻されて 30 秒後に再配信されます(配信は最初の 1 回を含めて最大 4 回。`MAIL_QUEUE_MAX_ATTEMPTS`)。どちらの再試行にも上限があるため、制限の超過が続くと、使い切った宛先は送られないまま失敗として計上されます。production で使う前に、staging で数十件の一斉メールを送り、失敗件数が 0 になることを確かめてください。

## 7. CI/CD パイプライン

`ci.yml`(typecheck/lint/test/e2e)に加えて、デプロイ用に 3 ファイルを置いています。ステップ構成が staging と production でほぼ同一なため、実体は `workflow_call` の再利用ワークフロー 1 つで、呼び出し側は環境ごとの差分だけを渡します。

| ファイル | トリガー | 役割 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | `workflow_call` | 実体。checkout → `bun install` → typecheck/test → フロントエンドのビルド → Supabase link → マイグレーション適用 → Worker デプロイ → Pages デプロイ → `/api/*` の疎通確認 |
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
- **`/api/*` の route はワークフローが付ける**。`wrangler.toml` に `routes` は書かず、Environment 変数 `FRONTEND_HOST` から `--route` を組み立てます。アカウントが持たないゾーンを `wrangler.toml` に書くと `wrangler deploy` 自体が落ちるためで、実ドメインの有効化をコード変更なしの設定変更で済ませる狙いもあります(6.4)。
- **最後に `/api/*` の疎通を確認する**。route はデプロイが成功しても効いていないことがあり、その場合ページは描画されるのにブラウザからの API 呼び出しだけが 404 になります。`FRONTEND_HOST` のオリジンで `/api/healthz` を叩き、返らなければデプロイを失敗させます。
- **フロントエンドのビルドはマイグレーションより前**。`ci.yml` は typecheck/lint/test/e2e までで `build` を実行しないため、`vite build` が初めて走るのはこのジョブです。Pages アップロードの直前に置くと、ビルド失敗が「マイグレーション適用済み・新 Worker 適用済み・フロントエンドだけ古い」状態を残すので、typecheck / test と並べて前倒ししています。

再デプロイが必要になった場合は、対象ワークフローを `workflow_dispatch` から再実行してください。`supabase db push` は適用済みマイグレーションを飛ばすため、Cloudflare 側だけが失敗したケースはワークフロー全体の再実行で回復できます。

## 8. デプロイ後の確認

ワークフローが全ステップ成功しても、Worker / Pages が実行時に読む値(6.2・6.3)の誤りは表に出ません。次の順に確認すると、どこで途切れているかを切り分けられます。

- `GET https://<worker-domain>/api/healthz` が `{ "ok": true }` を返すこと(Hono 側が `basePath('/api')` なので `/healthz` 単体は 404 になる)。**DB を使わないので、Worker が起動していることしか分からない**
- `GET https://<worker-domain>/api/tournaments/<存在しない地域>/saikyoi` が `404 {"error":"tournament not found"}` を返すこと。500 なら Worker から Supabase に届いていない(`SUPABASE_URL` が `https://<project ref>.supabase.co` の形になっているか、`SUPABASE_SECRET_KEY` が正しいかを確認する)
- フロントエンドの `/<存在しない地域>/saikyoi/entry` が 404 を返すこと。500 なら Pages から Worker に届いていない(`BACKEND_URL`)。大会種別は `saikyoi` / `shinjinou` にすること。不正な種別だとフロントエンドが API を呼ぶ前に 404 を返すため、確認にならない
- フロントエンドの `/password-reset` の HTML に埋め込まれた `env` に `PUBLIC_TURNSTILE_SITE_KEY` が入っていること(`env: {}` なら Turnstile が表示されない)
- フロントエンドのオリジンで `/api/healthz` が返るかどうかが、6.4 の Worker route が効いているかの確認になる(`FRONTEND_HOST` 未設定の間は 404。設定していればワークフローの最後のステップが自動で確認する)
- **ブラウザから直接叩く API** が疎通すること。SSR は route が無くても `handleFetch` で通ってしまうため、ここだけは別に確認する。スタッフ管理画面のエントリー一覧から CSV ダウンロードのリンクを踏んでファイルが落ちること、`/admin/tournaments/new` から大会を作成できること

500 の原因は `bunx wrangler tail --env <name>`(Worker)/ `bunx wrangler pages deployment tail <deployment id> --project-name <name>`(Pages)を流しながらリクエストを送ると、エラーとスタックトレースで分かります。
- GitHub Actions の該当ワークフローが全ステップ成功していること
- Supabase Dashboard の `Table Editor` で、適用したマイグレーション分のテーブル・型(enum)が反映されていること
- Supabase Dashboard の `Database > Migrations` で、適用済みマイグレーションの一覧に最新のものが含まれること

### 8.1 最初の統括スタッフを作る

スタッフのアカウントは、統括スタッフが画面(`/admin/staff`)または `POST /api/staff/accounts` から招待して作ります(`docs/api-endpoints.md`)。ただし**この API 自体が統括スタッフ限定**なので、構築したばかりの環境では最初の 1 人を作れません。最初の統括スタッフだけは、Supabase の SQL Editor から直接作ります。

マイグレーションは空のテーブルを作るだけで、スタッフの行は入れません。シードに入れていないのは、環境ごとに担当者のメールアドレスが違うことと、パスワードを決め打ちするとリポジトリや手順書に残ってしまうからです。

#### 手順

1. ローカルで、作りたいアカウントのメールアドレスと、その環境のフロントエンドの URL(Pages の `FRONTEND_URL` と同じもの)を渡してスクリプトを実行する

   ```bash
   cd apps/backend
   bun run staff:bootstrap you@example.com https://regional-quiz-frontend-staging.pages.dev
   ```

   SQL とパスワード設定用のリンクが表示されます。スクリプトは Supabase にも Worker にも接続しないので、シークレットは要りません。

2. 対象の環境の Supabase Dashboard を開き、`SQL Editor` に表示された SQL を貼り付けて実行する。**staging と production を取り違えないよう、左上のプロジェクト名を確認すること**
3. 24 時間以内に、表示されたリンクをブラウザで開いてパスワードを設定する。招待メールのリンクで設定するときと同じ画面です
4. `/staff/login` から、区分に「統括スタッフ」を選んでログインし、`/staff/dashboard` に移動すれば完了
5. 2 人目以降の統括スタッフと地域スタッフは、`/admin/staff` から招待する

#### 補足

- **パスワードはどこにも書きません。** SQL が入れるのはハッシュ形式に合わない固定値(`UNUSABLE_PASSWORD_HASH`)と、リンクのトークンの SHA-256 ハッシュだけです。API で招待したときと同じ状態の行ができ、パスワードは本人がリンク先で決めます
- **メールは送りません。** `MAIL_API_KEY` を登録する前の環境でも使えます。一方 `/admin/staff` からの招待はメールでリンクを送るため、メールが送れない環境では「アカウントは作られたがリンクが届かない」状態になります(`500 {"error": "account created but the setup mail could not be sent"}`)
- **表示されたリンクは、そのアカウントのパスワードを決められる鍵です。** チャットなどに貼らず、自分のブラウザで開くこと。漏れたかもしれないときは、スクリプトを再実行して新しい SQL を実行すれば、古いリンクは使えなくなります
- **同じメールアドレスで再実行できます。** 統括スタッフが既にあればアカウントは作り直さず、リンクだけを発行し直します。リンクの期限が切れた場合や、統括スタッフが 1 人しかいない環境でその人がパスワードを忘れた場合にも、この手順で再設定できます(統括スタッフが他にいるなら、その人が `/admin/staff` からリンクを再発行する方が早いです)
- **無効化された統括スタッフのアドレスを渡すと、有効に戻します**(#156)。統括スタッフの権限を失った環境を復旧するための手順なので、ログインできないアカウントにリンクだけ出しても意味が無いためです
- スタッフアカウントは `(メールアドレス, 担当種別)` で一意です(#166)。同じアドレスの地域スタッフのアカウントがあっても、それには触れず、そのアドレスの統括スタッフのアカウントを別に作ります(ログイン時の区分で選び分けます)。地域スタッフのパスワード再設定は、統括スタッフが `/admin/staff` から行ってください
- アドレスは小文字にしてから SQL に入れます(#133)

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
- [ ] `CLIENT_IP_FORWARD_SECRET` を環境ごとに個別発行し、Worker と Pages の両方に同じ値を登録した(6.2 / 6.3)
- [ ] GitHub の `staging` / `production` Environments を作成し、Secrets を登録した
- [ ] `SUPABASE_ACCESS_TOKEN` を環境ごとに対象プロジェクトへスコープを絞って発行した(6.5。`api_gateway_keys_read` を含める)
- [ ] production Environment に Required reviewers を設定した
- [ ] 各 Worker 環境に `wrangler secret put` でシークレットを登録した(6.2)
- [ ] 環境ごとに Turnstile widget を作成し、Secret Key を Worker に登録した(6.2)
- [ ] 一斉メール用の Queue と dead letter queue を環境ごとに作成した(6.2.2。Free プランでは保持期間 24 時間を指定)
- [ ] Pages プロジェクトを production branch `main` で作成した(6.3)
- [ ] Pages プロジェクトに `BACKEND_URL` / `SESSION_SECRET` / `CLIENT_IP_FORWARD_SECRET` / `PUBLIC_TURNSTILE_SITE_KEY` を CLI で登録し、`pages secret list` で 4 つとも確認した(6.3)
- [ ] ドメインを取得し、Cloudflare のゾーンに追加した(6.4)
- [ ] Pages プロジェクト(production / staging)にカスタムドメインを割り当てた(6.3 / 6.4)
- [ ] GitHub の各 Environment に `FRONTEND_HOST` 変数を登録し、`/api/*` が Worker に届くことを確認した(6.4 / 6.5 / #101)
- [ ] Turnstile widget にカスタムドメインのホスト名を追加した(6.2 / 6.4)
- [ ] Resend で `MAIL_FROM_ADDRESS` の送信用ドメインを検証し、DMARC を追加した(6.6)
- [ ] 送信ドメインに限定した Resend の API キーを `MAIL_API_KEY` として Worker に登録し、スタッフの招待メールが届くことを確認した(6.6)
- [ ] `bunx supabase db push --linked --dry-run` で初回マイグレーション適用の差分を確認した
- [ ] staging の `deploy-staging` ワークフローが全ステップ成功することを確認した
- [ ] production への初回デプロイ後、`/api/healthz` とトップページの疎通を確認した
- [ ] 最初の統括スタッフを SQL Editor から作り、`/staff/login` からログインできることを確認した(8.1)

## 11. 参考リンク

- Supabase CLI Local Development: https://supabase.com/docs/guides/local-development
- Supabase API keys(publishable / secret key): https://supabase.com/docs/guides/api/api-keys
- Supabase スコープ付き Personal Access Token: https://supabase.com/changelog/scoped-personal-access-tokens-ga
- Cloudflare Queues の Free プラン対応: https://developers.cloudflare.com/changelog/product/queues/
- Supabase CLI Managing Environments: https://supabase.com/docs/guides/deployment/managing-environments
- Supabase CLI コマンドリファレンス: https://supabase.com/docs/reference/cli
- Wrangler Environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Wrangler Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Resend Domains: https://resend.com/docs/dashboard/domains/introduction
- Resend の料金・制限: https://resend.com/pricing
- Cloudflare Pages デプロイ(Wrangler 経由): https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
