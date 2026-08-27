[← tasks.md](../tasks.md) / Phase 8: 非機能・仕上げ

### Task 8-1: E2E テスト整備 ✅

#### 実装・更新内容

* Playwright を `apps/e2e`(新規ワークスペース)に導入し、以下の主要フローを E2E テストとしてカバーする。
  * エントリー登録 → 確認メールのリンク → マイページ確認(`tests/entry-flow.spec.ts`)
  * 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認(`tests/waitlist-flow.spec.ts`)
  * 地域スタッフのログイン → 参加者一覧確認 → CSV ダウンロード(`tests/staff-csv.spec.ts`)
* テストハーネスは Playwright の `webServer` で組み立てる。
  * `bunx vite dev`(`apps/frontend` の SvelteKit アプリ。#74 で追加)
  * `bunx wrangler dev`(`apps/backend` の Worker)
  * `support/mail-sink.ts`(Resend HTTP API の stub)
  * ローカル Supabase は別途 `bun run db:start` で起動する(Docker イメージ取得を毎回のテスト実行に巻き込まないため)
* `support/global-setup.ts` が実行ごとに全テーブルを空にし、`support/fixtures.ts` の地域・大会・レギュレーション・フォーム項目定義・スタッフアカウントを固定 UUID で入れ直す。
* `apps/backend/src/lib/mailer.ts` に `MAIL_API_BASE_URL` バインディングと `createMailSender()` を追加し、送信先の API オリジンを差し替えられるようにする(既定は Resend 本体なので本番の挙動は変わらない)。

#### スコープ: 当初は API レベル → #74 で UI レベルへ

このタスクの時点では、フロー上の画面がまだ存在しなかったため、テストはブラウザを使わず Playwright の `request` context から HTTP API を叩いていた。UI レベルへの引き上げは #74 に分割し、下記の画面と配線が揃ったあとに実施済み。

| 当時欠けていたもの | issue |
| --- | --- |
| エントリーフォーム画面がプレースホルダのまま | #69 |
| 参加者ログイン画面が無い | #70 |
| スタッフログイン画面が無い | #71 |
| メール確認 `/verify` 画面が無い | #72 |
| フロントエンドから `/api/*` に到達する配線が無い | #73 |

#### #74 での引き上げ内容

* Playwright の `webServer` に `bunx vite dev`(`--strictPort`、`BACKEND_URL` / `SESSION_SECRET` は `env` で明示)を追加し、`use.baseURL` をフロントエンドに向けた。プロジェクトは Chromium 1つ。
* 3本の spec を全てブラウザ操作に置き換えた。画面の掴み方(ラベル・ボタン・リンク)は `support/ui.ts` に集約し、CSS クラスやテスト専用属性には依存しない。
  * エントリーフォームに実入力して送信 → メール本文のリンクを `page.goto` で開く → 参加者ログイン画面を経て `/mypage` を確認
  * `/mypage` のキャンセルボタン(`window.confirm` のダイアログを含む)を操作し、公開エントリーリスト画面で繰り上げ後の表示を確認
  * スタッフログイン画面からログイン → `/staff/:regionSlug/:tournamentSlug/entries` の表を検証 → 「CSV をダウンロード」を `page.waitForEvent('download')` で受ける
* API を直接叩くのはメール stub の読み出しと `staff-csv.spec.ts` の前準備だけになり、`support/api.ts` からセッション系のヘルパーを落とした。
* Worker を平文 HTTP に戻した(下記)。
* CI(`.github/workflows/ci.yml`)の `e2e` ジョブに `bunx playwright install --with-deps chromium` を追加した。

#### 当初のコードスニペットからの変更点

計画時のスニペットは、確認トークンをテスト専用 API(`GET /api/test/latest-verification-token`)で取り出す想定だった。実装では代わりに **Resend HTTP API の stub を立て、実際に送られたメール本文からトークンを取り出す**。トークンを配る エンドポイントが本番コードに残らず、メール送信そのものも経路として検証できるため。

UI レベルになった今も同じで、メール本文のリンクをブラウザでそのまま開いている(`support/ui.ts`)。

```typescript
// apps/e2e/support/ui.ts
export async function openVerificationLink(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const mail = await waitForMail(request, email, VERIFICATION_MAIL_SUBJECT);
  const link = extractVerificationUrl(mail.html);
  await page.goto(link);
  return link;
}
```

もう一点、当初バックエンドは `wrangler dev --local-protocol https` で **HTTPS** 起動していた。セッション Cookie は本番同様 `Secure` 付きで発行され、Playwright の API request context はそうした Cookie を `http://` に送り返さないため、`http://` だとアプリ側に無い理由で認証付きステップが全部 401 になっていたからである。#74 でセッションをブラウザが持つようになりこの理由は消え、逆に自己署名証明書だと SvelteKit のサーバ側 `fetch` が全て落ちるため、平文の HTTP に戻した。

#### テスト

* 上記 E2E テストファイル自体がテストであり、CI(`.github/workflows/ci.yml`)に `e2e` ジョブを追加して `bun run test:e2e` を実行する。#74 以降はブラウザを使うため、その前に `bunx playwright install --with-deps chromium` を実行する。
* `apps/backend/src/lib/mailer.test.ts` に `createMailSender()` の分岐(バインディング未設定 / 空文字 / 指定あり / 末尾スラッシュ)のテストを追加。

詳細な実行方法・設計上の判断は [`apps/e2e/README.md`](../apps/e2e/README.md) を参照。

#### 依存タスク

* Task 3-3, Task 3-4, Task 5-2, Task 6-4
