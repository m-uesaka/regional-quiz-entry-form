# `@regional-quiz/e2e`

Playwright による E2E テスト(Task 8-1)。`apps/backend` を `wrangler dev` で実際に起動し、ローカルの Supabase を相手に主要フローを通します。

## 実行方法

```bash
# 一度だけ: ローカル Supabase(Docker が必要)を起動する
bun run db:start

# リポジトリルートから
bun run test:e2e
```

`bun run test:e2e` が起動するもの:

| プロセス | 用途 |
| --- | --- |
| `bun run support/mail-sink.ts`(`http://127.0.0.1:8788`) | Resend HTTP API の stub。送信されたメールを溜め、テストから読み出せるようにする |
| `bunx wrangler dev`(`https://127.0.0.1:8787`) | `apps/backend` の Worker |

Supabase は起動しません(Docker イメージの取得を毎回のテスト実行に巻き込まないため)。起動していない場合は `support/seed.ts` が起動コマンドを添えて落ちます。

ブラウザは起動しないので `playwright install` は不要です(下の「現状は API レベル」を参照)。

### 環境変数

いずれも省略可能です。

| 変数 | 既定値 |
| --- | --- |
| `SUPABASE_URL` | `http://127.0.0.1:54321` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase CLI がローカルスタックに発行する既定のキー |
| `E2E_BACKEND_PORT` | `8787` |
| `E2E_MAIL_SINK_PORT` | `8788` |

ローカルスタックのキーが既定値と違う場合は、`eval "$(bunx supabase status -o env)"` で export してから実行してください。

## カバーしているフロー

`tests/` の3本が issue #41 の3フローに対応します。

| ファイル | フロー |
| --- | --- |
| `entry-flow.spec.ts` | エントリー登録 → 確認メール → マイページ確認 |
| `waitlist-flow.spec.ts` | 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認 |
| `staff-csv.spec.ts` | 地域スタッフのログイン → 参加者一覧確認 → CSV ダウンロード |

## 現状は API レベル

**このパッケージのテストはブラウザを使わず、Playwright の `request` context から HTTP API を叩いています。** UI 経由にできないのは、フロー上の画面がまだ存在しないためです。

- エントリーフォーム画面がプレースホルダのまま(#69)
- 参加者ログイン画面が無い(#70)
- スタッフログイン画面が無い(#71)
- メール確認 `/verify` 画面が無い(#72)
- フロントエンドから `/api/*` に到達する配線が無い(#73)

これらが揃ったら、同じハーネス(Supabase + `wrangler dev` + メール stub)の上で `vite dev` を足し、3本をブラウザ操作に置き換えます(#74)。

## 設計上のポイント

### メールは stub で受ける

エントリー確認トークンは**リクエストごとに生成され、DB には SHA-256 ハッシュしか残りません**(`apps/backend/src/lib/token.ts`)。つまり生のトークンが現れるのはメール本文だけなので、テストがメールを読めないとフローが進みません。

そのため `apps/backend/src/lib/mailer.ts` に `MAIL_API_BASE_URL` バインディングを足し、`createMailSender()` 経由で送信先の API オリジンを差し替えられるようにしてあります。既定値は Resend 本体なので、本番の挙動は変わりません。

### バックエンドは HTTPS で起動する

セッション Cookie は本番同様 `Secure` 付きで発行されます。Playwright の API request context はそうした Cookie を保存はするものの `http://` には送り返さないため、`http://` で起動すると**アプリ側に無い理由で**認証付きのステップが全部 401 になります。`wrangler dev --local-protocol https`(自己署名証明書 + `ignoreHTTPSErrors`)で起動しているのはこのためです。

### シード

`support/global-setup.ts` が実行ごとに全テーブルを空にし、`support/fixtures.ts` の地域・大会・レギュレーション・フォーム項目定義・スタッフアカウントを固定 UUID で入れ直します。地域・大会・スタッフを作る API が無い(`docs/api-endpoints.md` の「未実装」節)ため、ここだけは Supabase の Data API を直接使っています。

大会は2つあり、テスト同士が干渉しないよう用途を分けています。

- `SAIKYOI`(定員 1): `waitlist-flow.spec.ts` 専用
- `SHINJINOU`(定員なし): それ以外

参加者のメールアドレスは毎回 UUID 付きで生成するので、同じスタックに対して繰り返し実行しても `participants.email` の unique 制約に当たりません。
