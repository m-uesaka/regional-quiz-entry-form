# regional-quiz-entry-form

TypeScript + Hono のバックエンドと SvelteKit のフロントエンドからなる Bun workspaces モノレポ。実装はまだこれから(2026-08-23時点でコードは未着手)。以下は合意済みのアーキテクチャ方針。実装を始める際はこの構成でディレクトリを作ること。

## 構成

- パッケージ管理 / ワークスペース: **Bun workspaces**(Turborepo 等の追加ツールは使わない)
- バックエンド: `apps/backend` — **Hono**、**Cloudflare Workers** にデプロイ(D1/KV/R2 等の bindings を使う可能性あり)
- フロントエンド: `apps/frontend` — **SvelteKit**。API ルートは自前で持たず、`apps/backend` の Hono API を呼び出す(SvelteKit の `+page.server.ts` 等から叩くか、クライアントから直接叩くかは実装時に決定)
- 共有パッケージ: `packages/shared` — バックエンド/フロントエンド間で共有する Zod スキーマと型定義

## 型安全な API 連携

- `apps/backend` は Hono のルートをチェーンして `export type AppType = typeof routes` を公開する
- `apps/frontend` は `hono/client` の `hc<AppType>()` を使って型安全に API を呼ぶ(手書きの fetch ラッパーを増やさない)
- リクエスト/レスポンスの Zod スキーマは `packages/shared` に置き、`@hono/zod-validator` (バックエンド)とフォームバリデーション(フロントエンド)の両方から同じスキーマを import する。バックエンドとフロントエンドで別々にスキーマを定義しない

## TypeScript コーディング規約

- このリポジトリの TypeScript コード(`apps/backend` / `apps/frontend` 双方)は **Google TypeScript Style Guide** (https://google.github.io/styleguide/tsguide.html) に従う。ルールの要約は `.claude/skills/google-ts-style/SKILL.md` を参照(実装・レビュー用エージェントはここを自動的に読み込む)
- SvelteKit のファイルベースルーティング(`+page.svelte` 等の default export)のようにフレームワークが要求する書き方は、スタイルガイドの「no default export」ルールより優先する
- 実装が進みコードベースが立ち上がったら、Google 公式の `gts`(ESLint + Prettier + tsc をこのスタイルガイドに沿って設定したパッケージ)の導入を検討する。現時点(2026-08-23)ではまだ `apps/` 自体が存在しないため未導入

## エージェント / スキル

- `.claude/agents/hono-backend-engineer.md` — Hono バックエンド実装用サブエージェント
- `.claude/agents/sveltekit-frontend-engineer.md` — SvelteKit フロントエンド実装用サブエージェント
- `.claude/agents/fullstack-reviewer.md` — バックエンド/フロントエンド間の型契約・セキュリティ観点・Google TS スタイル準拠も含むレビュー用サブエージェント
- `.claude/skills/google-ts-style/SKILL.md` — 手動で作成した、このプロジェクトの TypeScript コーディング規約(Google スタイルガイド)。`skills-lock.json` には登録されていない(CLI 管理外)ため `.gitignore` で個別に追跡対象化している
- `.claude/skills/typescript/SKILL.md` — 元は `dalestudy/skills@typescript`(韓国語)。全文英訳した上で `skills-lock.json` から外し、`.gitignore` で個別に追跡対象化している。`npx skills update` 等で再インストールすると韓国語に戻るので注意
- `.claude/skills/create-tasks/SKILL.md`(実体: `.agents/skills/create-tasks/`) — 要件ファイルからタスクリスト(`tasks.md`)を生成するスキル。`disable-model-invocation: true` のため自動では発火せず、明示的に呼び出す。CLI管理外のため `.gitignore` で個別に追跡対象化している
- `.claude/skills/resolve-pr-comments/SKILL.md`(実体: `.agents/skills/resolve-pr-comments/`) — PR の未解決コメントを検出し、コードを修正した上でコメントに返信するスキル。`disable-model-invocation: true` のため自動では発火せず、明示的に呼び出す。CLI管理外のため `.gitignore` で個別に追跡対象化している
- 導入済みスキル(`skills-lock.json` 参照): `bun`, `hono`, `svelte-code-writer`, `svelte-core-bestpractices`。`.svelte` / `.svelte.ts` を編集する際は `svelte-code-writer` / `svelte-core-bestpractices` が自動的に参照される
