[← tasks.md](../tasks.md) / Phase 8: 非機能・仕上げ

### Task 8-1: E2E テスト整備

#### 実装・更新内容

* Playwright を導入し、以下の主要フローを E2E テストとしてカバーする。
  * エントリー登録 → 確認メールのリンク(テスト用に発行トークンを直接取得) → マイページ確認
  * 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認
  * 地域スタッフのログイン → 参加者一覧確認 → CSV ダウンロード

#### コードスニペット

`apps/frontend/e2e/entry-flow.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('participant can enter, verify email, and see the entry in mypage', async ({ page, request }) => {
  await page.goto('/tokyo/saikyoi/entry');
  await page.fill('input[name=name]', 'テスト太郎');
  // ...他フィールド入力
  await page.click('button[type=submit]');

  const { token } = await (await request.get('/api/test/latest-verification-token')).json();
  await page.goto(`/verify?token=${token}`);

  await page.goto('/mypage/login');
  // ...ログイン
  await expect(page.locator('text=テスト太郎')).toBeVisible();
});
```

#### テスト

* 上記 E2E テストファイル自体がテストであるため、CI(Task 0-6 のワークフロー)に `bun run test:e2e` を追加して実行する

#### 依存タスク

* Task 3-3, Task 3-4, Task 5-2, Task 6-4
