[← tasks.md](../tasks.md) / Phase 0: モノレポ基盤構築 ✅完了

### Task 0-1: Bun workspaces のルート構成 ✅

#### 実装・更新内容

* リポジトリ直下に `apps/backend`, `apps/frontend`, `packages/shared` のディレクトリを作成する。
* ルート `package.json` に `workspaces` を定義し、共通スクリプト(`dev`, `build`, `typecheck`, `test`, `lint`)を各ワークスペースに委譲する形で用意する。
* ルート `tsconfig.base.json` を作成し、各ワークスペースの `tsconfig.json` から `extends` する。

#### コードスニペット

`package.json`

```json
{
  "name": "regional-quiz-entry-form",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:backend": "bun --filter ./apps/backend dev",
    "dev:frontend": "bun --filter ./apps/frontend dev",
    "typecheck": "bun --filter '*' typecheck",
    "test": "bun --filter '*' test",
    "lint": "bun --filter '*' lint"
  }
}
```

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

#### テスト

* 手動確認のみ(ワークスペース構成の疎通確認)
  * `bun install` がエラーなく完了すること
  * `bun --filter '*' typecheck` が(中身が空でも)実行できること

#### 依存タスク

* なし(最初のタスク)
