[← tasks.md](../tasks.md) / Phase 8: 非機能・仕上げ

### Task 8-1: E2E テスト整備 ✅

#### 実装・更新内容

* Playwright を `apps/e2e`(新規ワークスペース)に導入し、以下の主要フローを E2E テストとしてカバーする。
  * エントリー登録 → 確認メールのリンク → マイページ確認(`tests/entry-flow.spec.ts`)
  * 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認(`tests/waitlist-flow.spec.ts`)
  * 地域スタッフのログイン → 参加者一覧確認 → CSV ダウンロード(`tests/staff-csv.spec.ts`)
* テストハーネスは Playwright の `webServer` で組み立てる。
  * `bunx wrangler dev`(`apps/backend` の Worker)
  * `support/mail-sink.ts`(Resend HTTP API の stub)
  * ローカル Supabase は別途 `bun run db:start` で起動する(Docker イメージ取得を毎回のテスト実行に巻き込まないため)
* `support/global-setup.ts` が実行ごとに全テーブルを空にし、`support/fixtures.ts` の地域・大会・レギュレーション・フォーム項目定義・スタッフアカウントを固定 UUID で入れ直す。
* `apps/backend/src/lib/mailer.ts` に `MAIL_API_BASE_URL` バインディングと `createMailSender()` を追加し、送信先の API オリジンを差し替えられるようにする(既定は Resend 本体なので本番の挙動は変わらない)。

#### スコープ: API レベルにとどめた理由

**このタスクのテストはブラウザを使わず、Playwright の `request` context から HTTP API を叩いている。** フロー上の画面がまだ存在しないためで、UI レベルへの引き上げは #74 に分割した。

| 欠けているもの | issue |
| --- | --- |
| エントリーフォーム画面がプレースホルダのまま | #69 |
| 参加者ログイン画面が無い | #70 |
| スタッフログイン画面が無い | #71 |
| メール確認 `/verify` 画面が無い | #72 |
| フロントエンドから `/api/*` に到達する配線が無い | #73 |

#### 当初のコードスニペットからの変更点

計画時のスニペットは、確認トークンをテスト専用 API(`GET /api/test/latest-verification-token`)で取り出す想定だった。実装では代わりに **Resend HTTP API の stub を立て、実際に送られたメール本文からトークンを取り出す**。トークンを配る エンドポイントが本番コードに残らず、メール送信そのものも経路として検証できるため。

```typescript
// apps/e2e/support/api.ts
export async function verifyEntry(
  request: APIRequestContext,
  email: string,
): Promise<EntryStatus> {
  const mail = await waitForMail(request, email, 'エントリー確認メール');
  const token = extractVerificationToken(mail.html);
  const response = await request.get(`/api/entries/verify?token=${token}`);
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as {status: EntryStatus};
  return body.status;
}
```

もう一点、バックエンドは `wrangler dev --local-protocol https` で **HTTPS** 起動している。セッション Cookie は本番同様 `Secure` 付きで発行され、Playwright の API request context はそうした Cookie を `http://` に送り返さないため、`http://` だとアプリ側に無い理由で認証付きステップが全部 401 になる。

#### テスト

* 上記 E2E テストファイル自体がテストであり、CI(`.github/workflows/ci.yml`)に `e2e` ジョブを追加して `bun run test:e2e` を実行する。ブラウザは起動しないので `playwright install` は不要。
* `apps/backend/src/lib/mailer.test.ts` に `createMailSender()` の分岐(バインディング未設定 / 空文字 / 指定あり / 末尾スラッシュ)のテストを追加。

詳細な実行方法・設計上の判断は [`apps/e2e/README.md`](../apps/e2e/README.md) を参照。

#### 依存タスク

* Task 3-3, Task 3-4, Task 5-2, Task 6-4
