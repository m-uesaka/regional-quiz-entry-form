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

## エージェント / スキル

- `.claude/agents/hono-backend-engineer.md` — Hono バックエンド実装用サブエージェント
- `.claude/agents/sveltekit-frontend-engineer.md` — SvelteKit フロントエンド実装用サブエージェント
- `.claude/agents/fullstack-reviewer.md` — バックエンド/フロントエンド間の型契約・セキュリティ観点も含むレビュー用サブエージェント
- 導入済みスキル(`skills-lock.json` 参照): `bun`, `hono`, `typescript`, `svelte-code-writer`, `svelte-core-bestpractices`。`.svelte` / `.svelte.ts` を編集する際は `svelte-code-writer` / `svelte-core-bestpractices` が自動的に参照される
