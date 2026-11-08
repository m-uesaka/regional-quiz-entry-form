# regional-quiz-entry-form

TypeScript + Hono のバックエンドと SvelteKit のフロントエンドからなる Bun workspaces モノレポ。実装は進行中(2026-08-23時点で `apps/backend`(スタッフ認証・大会情報 API 等)、`apps/frontend`(SvelteKit の初期スキャフォールド)、`packages/shared`(Zod スキーマ)に着手済み)。以下は合意済みのアーキテクチャ方針。新規実装・既存コードの変更はこの構成に沿って行うこと。

## 構成

- パッケージ管理 / ワークスペース: **Bun workspaces**(Turborepo 等の追加ツールは使わない)
- バックエンド: `apps/backend` — **Hono**、**Cloudflare Workers** にデプロイ。永続化は D1/KV/R2 ではなく **Supabase**(`@supabase/supabase-js`)を使用し、接続情報(`SUPABASE_URL` / `SUPABASE_SECRET_KEY` 等)は Worker の `Bindings`(`src/types/env.ts`)経由の secrets として渡す
- フロントエンド: `apps/frontend` — **SvelteKit**。API ルートは自前で持たず、`apps/backend` の Hono API を呼び出す(SvelteKit の `+page.server.ts` 等から叩くか、クライアントから直接叩くかは実装時に決定)
- 共有パッケージ: `packages/shared` — バックエンド/フロントエンド間で共有する Zod スキーマと型定義
- E2E テスト: `apps/e2e` — **Playwright**。`vite dev` で起動した `apps/frontend`、`wrangler dev --local-protocol https` で起動した `apps/backend`、`bun run db:start` で起動したローカル Supabase を相手に、主要フローを Chromium のブラウザ操作で通す(画面の掴み方は `support/ui.ts` に集約。詳細は `apps/e2e/README.md`)。実行は `bun run test:e2e`(通常の `bun run test` には含まれない)。事前に `bunx playwright install chromium` が必要

## ブランチ運用 / デプロイ

- `develop` への merge で staging(dev 環境)に、`main` への merge で production にデプロイされる(`.github/workflows/deploy-*.yml`)
- 機能ブランチは `develop` から切り、PR は `develop` 向けに出す。リリースは `develop` → `main` の PR で行う
- 詳細は `docs/supabase-deployment.md` 7 章

## 型安全な API 連携

- `apps/backend` は Hono のルートをチェーンして `export type AppType = typeof routes` を公開する
- `apps/frontend` は `hono/client` の `hc<AppType>()` を使って型安全に API を呼ぶ(手書きの fetch ラッパーを増やさない)
- リクエスト/レスポンスの Zod スキーマは `packages/shared` に置き、`@hono/zod-validator` (バックエンド)とフォームバリデーション(フロントエンド)の両方から同じスキーマを import する。バックエンドとフロントエンドで別々にスキーマを定義しない

## TypeScript コーディング規約

- このリポジトリの TypeScript コード(`apps/backend` / `apps/frontend` 双方)は **Google TypeScript Style Guide** (https://google.github.io/styleguide/tsguide.html) に従う。ルールの要約は `.claude/skills/google-ts-style/SKILL.md` を参照(実装・レビュー用エージェントがタスク開始時に一度だけ読み込む。ファイル編集のたびに再ロードさせない)
- SvelteKit のファイルベースルーティング(`+page.svelte` 等の default export)のようにフレームワークが要求する書き方は、スタイルガイドの「no default export」ルールより優先する
- Google 公式の `gts`(ESLint + Prettier + tsc をこのスタイルガイドに沿って設定したパッケージ)は `apps/backend` / `apps/frontend` / `packages/shared` の全パッケージに導入済み(各 `package.json` の `lint` / `fix` スクリプト)。quote スタイル・`var`・`==`・switch フォールスルー・`Array()` コンストラクタなど機械的に検出できるルールは `bun run lint`(または各パッケージの `gts fix`)に任せ、`google-ts-style` スキルは lint で拾えない設計判断・命名規約側に集中させる(スキル本文冒頭に検証済みの対応表あり)

## エージェント / スキル

- `.claude/agents/hono-backend-engineer.md` — Hono バックエンド実装用サブエージェント
- `.claude/agents/sveltekit-frontend-engineer.md` — SvelteKit フロントエンド実装用サブエージェント
- `.claude/agents/fullstack-reviewer.md` — バックエンド/フロントエンド間の型契約・セキュリティ観点・Google TS スタイル準拠も含むレビュー用サブエージェント
- `.claude/skills/google-ts-style/SKILL.md` — 手動で作成した、このプロジェクトの TypeScript コーディング規約(Google スタイルガイド)。`skills-lock.json` には登録されていない(CLI 管理外)ため `.gitignore` で個別に追跡対象化している
- `.claude/skills/typescript/SKILL.md` — 元は `dalestudy/skills@typescript`(韓国語)。全文英訳した上で `skills-lock.json` から外し、`.gitignore` で個別に追跡対象化している。`npx skills update` 等で再インストールすると韓国語に戻るので注意
- `.claude/skills/create-tasks/SKILL.md`(実体: `.agents/skills/create-tasks/`) — 要件ファイルからタスクリスト(`tasks.md`)を生成するスキル。`disable-model-invocation: true` のため自動では発火せず、明示的に呼び出す。CLI管理外のため `.gitignore` で個別に追跡対象化している
- `.claude/skills/resolve-pr-comments/SKILL.md`(実体: `.agents/skills/resolve-pr-comments/`) — PR の未解決コメントを検出し、コードを修正した上でコメントに返信するスキル。`disable-model-invocation: true` のため自動では発火せず、明示的に呼び出す。CLI管理外のため `.gitignore` で個別に追跡対象化している
- 導入済みスキル(`skills-lock.json` 参照): `hono`(公式 `honojs/skills`。旧 `yusukebe/hono-skill` はアーカイブ済み), `bun-runtime`(`affaan-m/ECC`。旧 `flora131/atomic@bun` はメンテナンス終了。Bun 公式のユーザー向けスキルは存在しない), `svelte-code-writer`, `svelte-core-bestpractices`。`.svelte` / `.svelte.ts` を編集する際は `svelte-code-writer` / `svelte-core-bestpractices` が自動的に参照される
- 外部スキルの指示がこのファイルと食い違う場合は、このファイルを優先する。既知の食い違い:
  - `hono` スキルは「`Bindings` 型を手書きせず生成する」としているが、このリポジトリでは `apps/backend/src/types/env.ts` に手書きで定義する(コメントや省略可能なフィールドを持つため)。`wrangler types` 等で生成し直さない
  - `bun-runtime` スキルの Vercel 向けの記述は当てはまらない(デプロイ先は Cloudflare Workers)

## Hono CLI(`@hono/cli`)

`hono` スキルが動作確認に使う Hono CLI を `apps/backend` の devDependency として入れている(`1.0.0-rc.9` に固定。1.0 正式版が出たら `latest` に戻す)。コマンドは `apps/backend` で実行する。このリポジトリではスキルに書かれたとおりには動かないため、次のように使う:

- **`hono request` / `hono batch` には `--runtime workerd` を付ける**。`wrangler.toml` の `main`(`src/index.ts`)を workerd で動かし、`apps/backend/.dev.vars` の secrets(`SUPABASE_URL` / `SUPABASE_SECRET_KEY` 等)が `c.env` に入る。ローカル Supabase(`bun run db:start`)が必要
  - 例: `bunx hono request /api/portal/tournaments --runtime workerd`
  - 付けないと Node.js で `src/index.ts` を読み込もうとして失敗する(default export が Hono アプリではなく Worker の `{fetch, queue}` であるため)。`--runtime bun` は `c.env` が空になり、DB を使うルートが 500 になる
- **`hono routes` / `hono snapshot` は `bun run hono:routes` / `bun run hono:snapshot` を使う**。`app` を default export する `src/hono-cli-app.ts` を渡し、`-e yaml` を付けている(`packages/shared` が使う `yaml` は CommonJS で、CLI のバンドルに含めると `Dynamic require of "process" is not supported` になる)。追加のオプションは `bun run hono:snapshot --status-only` のように後ろに付ける
- **`hono diff` は使えない**。入口ファイルも `-e` も指定できず、上の理由で失敗する。変更前後の比較は、変更前に取った `hono:snapshot` の出力を変更後に `hono batch - --runtime workerd` で流し直して行う
  - `.dev.vars` があると snapshot の出力の先頭に wrangler の `Using vars defined in .dev.vars` という JSON でない行が混ざり、そのまま流すと batch が `BATCH_INVALID` になる。また `expect` を持つのはパラメータのない GET だけで、残り(`:id` を含むパスや POST 等)は `expect` のない雛形なので、そのまま流すと 4xx で失敗扱いになる。`expect` を持つ行だけを使う:
    ```sh
    bun run --silent hono:snapshot --status-only | grep '"expect"' > /tmp/before.jsonl
    # 変更後
    bunx hono batch - --runtime workerd --compact < /tmp/before.jsonl
    ```
- CLI で確認できない場合は、これまでどおり `app.request()` を使うテスト(`bun test`)で確認する
