# regional-quiz-entry-form

TypeScript + Hono のバックエンドと SvelteKit のフロントエンドからなる Bun workspaces モノレポです。2026-08-23 時点ではまだ実装前で、アーキテクチャ方針のみ合意済みです。詳細な構成・規約は [`CLAUDE.md`](./CLAUDE.md) を参照してください。

このリポジトリには、実装・コードレビューを支援するための Claude Code 用エージェント / スキルを用意しています。以下はその一覧です。

## エージェント (`.claude/agents/`)

Claude Code の `Agent` ツールから `subagent_type` に名前を指定して呼び出せるサブエージェントです。

| 名前 | 用途 |
| --- | --- |
| [`hono-backend-engineer`](./.claude/agents/hono-backend-engineer.md) | `apps/backend` の Hono 実装(ルーティング、ミドルウェア、バリデーション、Cloudflare Workers bindings、テスト)を担当。バックエンド単体のタスクで使用 |
| [`sveltekit-frontend-engineer`](./.claude/agents/sveltekit-frontend-engineer.md) | `apps/frontend` の SvelteKit 実装(ページ、コンポーネント、フォーム、API 呼び出し)を担当。フロントエンド単体のタスクで使用 |
| [`fullstack-reviewer`](./.claude/agents/fullstack-reviewer.md) | バックエンド/フロントエンド間の型契約(`AppType` / `hc()`)、バリデーション漏れ、Svelte 5 / Cloudflare Workers 特有の落とし穴、Google TypeScript Style Guide 準拠をチェックする読み取り専用のレビューア。汎用の `/code-review` を補完する位置づけ |

## スキル (`.claude/skills/`)

Claude Code がファイルの種類やタスク内容に応じて自動的に参照する知識です。`npx skills` (`skills-lock.json` 管理) で導入したものと、このリポジトリ用に手作業で用意したものがあります。

| 名前 | 用途 | 管理方法 |
| --- | --- | --- |
| [`bun`](./.claude/skills/bun/SKILL.md) | Bun でのスクリプト実行・依存管理・バンドル・テストに関する知識 | CLI管理 (`skills-lock.json`, 由来: `flora131/atomic`) |
| [`hono`](./.claude/skills/hono/SKILL.md) | Hono のルーティング・ミドルウェア・バリデーション・RPC クライアント等の API リファレンス | CLI管理 (`skills-lock.json`, 由来: `yusukebe/hono-skill`) |
| [`svelte-code-writer`](./.claude/skills/svelte-code-writer/SKILL.md) | Svelte 5 のドキュメント参照・コード解析用 CLI ツール。`.svelte` / `.svelte.ts` 編集時に必須 | CLI管理 (`skills-lock.json`, 由来: 公式 `sveltejs/ai-tools`) |
| [`svelte-core-bestpractices`](./.claude/skills/svelte-core-bestpractices/SKILL.md) | Svelte 5 のリアクティビティ・イベント処理・スタイリング等のベストプラクティス | CLI管理 (`skills-lock.json`, 由来: 公式 `sveltejs/ai-tools`) |
| [`typescript`](./.claude/skills/typescript/SKILL.md) | TypeScript の型定義・ベストプラクティス(型推論、型ガード、tsconfig、ユーティリティ型 等) | 手動管理。元は `dalestudy/skills@typescript`(韓国語)だが全文英訳し、`skills-lock.json` から外して個別に追跡している |
| [`google-ts-style`](./.claude/skills/google-ts-style/SKILL.md) | このプロジェクトの TypeScript コーディング規約。[Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) の MUST/SHOULD ルールを要約 | 手動作成。`skills-lock.json` 管理外 |
| [`create-tasks`](./.claude/skills/create-tasks/SKILL.md) | 要件ファイルと現在のコード構成から、リポジトリ直下に `tasks.md`(`docs/task-format.md` の書式)を生成する。`disable-model-invocation: true` のため自動発火せず、明示的に呼び出したときのみ使用される | 手動配置(`.agents/skills/create-tasks/`)。`skills-lock.json` 管理外 |

`.claude/skills/*` は基本的に `.gitignore` で無視されますが、上記の手動管理スキル(`typescript`, `google-ts-style`, `create-tasks`)は個別に `.gitignore` で追跡対象化しているため、他の CLI 管理スキルと違って `npx skills update` では上書きされません。

## スキル / エージェントの追加・更新

- 新しい CLI 管理スキルを追加: `npx skills add <owner/repo>@<skill>`
- 導入済みスキルの一覧・更新: `npx skills list` / `npx skills update`
- 新しいエージェントを追加する場合は `.claude/agents/` に Markdown ファイル(`name` / `description` / `tools` の frontmatter付き)を作成する
