[← tasks.md](../tasks.md) / Phase 0: モノレポ基盤構築 ✅完了

### Task 0-2: `packages/shared` の初期構成 ✅

#### 実装・更新内容

* `packages/shared/package.json`、`tsconfig.json` を作成し、`zod` と `yaml`(YAML パース用)を依存に追加する。
* `packages/shared/src/index.ts` をエントリポイントとして用意し、以降のタスクでスキーマを追加していく器を作る。

#### コードスニペット

`packages/shared/package.json`

```json
{
  "name": "@regional-quiz/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "zod": "^3.23.0",
    "yaml": "^2.5.0"
  }
}
```

`packages/shared/src/index.ts`

```typescript
export * from './schemas/region';
export * from './schemas/tournament';
export * from './schemas/regulation';
export * from './schemas/form-definition';
export * from './schemas/entry';
export * from './schemas/participant';
export * from './schemas/staff';
export * from './schemas/auth';
```

#### テスト

* `apps/backend` / `apps/frontend` の双方から `@regional-quiz/shared` を workspace 依存として import できることを型チェックで確認する(Phase 1 実施後に本格テスト)

#### 依存タスク

* Task 0-1
