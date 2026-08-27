# `@regional-quiz/e2e`

Playwright による E2E テスト(Task 8-1 / #74)。`apps/frontend` を `vite dev`、`apps/backend` を `wrangler dev` で実際に起動し、ローカルの Supabase を相手に主要フローをブラウザ操作で通します。

## 実行方法

```bash
# 一度だけ: ローカル Supabase(Docker が必要)を起動する
bun run db:start

# 一度だけ: ブラウザを取得する
bunx playwright install chromium

# リポジトリルートから
bun run test:e2e
```

`bun run test:e2e` が起動するもの:

| プロセス | 用途 |
| --- | --- |
| `bun run support/mail-sink.ts`(`http://127.0.0.1:8788`) | Resend HTTP API の stub。送信されたメールを溜め、テストから読み出せるようにする |
| `bunx wrangler dev`(`http://127.0.0.1:8787`) | `apps/backend` の Worker |
| `bunx vite dev`(`http://127.0.0.1:5173`) | `apps/frontend` の SvelteKit アプリ。ブラウザが触るのはこちらだけで、`/api/*` は vite の dev proxy 経由で Worker に届く |

Supabase は起動しません(Docker イメージの取得を毎回のテスト実行に巻き込まないため)。起動していない場合は `support/seed.ts` が起動コマンドを添えて落ちます。

ブラウザは Chromium 1つだけ使います。`bunx playwright install chromium` を一度実行しておいてください(未取得だと Playwright が起動時にその旨で落ちます)。

### 環境変数

いずれも省略可能です。

| 変数 | 既定値 |
| --- | --- |
| `SUPABASE_URL` | `http://127.0.0.1:54321` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase CLI がローカルスタックに発行する既定のキー |
| `E2E_BACKEND_PORT` | `8787` |
| `E2E_MAIL_SINK_PORT` | `8788` |
| `E2E_FRONTEND_PORT` | `5173` |

ローカルスタックのキーが既定値と違う場合は、`eval "$(bunx supabase status -o env)"` で export してから実行してください。

## カバーしているフロー

`tests/` の3本が issue #41 の3フローに対応します。

| ファイル | フロー |
| --- | --- |
| `entry-flow.spec.ts` | エントリー登録 → 確認メール → マイページ確認 |
| `waitlist-flow.spec.ts` | 定員超過時のキャンセル待ち登録 → キャンセル発生 → 繰り上げ確認 |
| `staff-csv.spec.ts` | 地域スタッフのログイン → 参加者一覧確認 → CSV ダウンロード |

3本ともブラウザ操作です。画面の掴み方(ラベル・ボタン・リンク)は `support/ui.ts` にまとめてあり、CSS クラスやテスト専用の属性には依存していません。

API を直接叩いているのは2箇所だけです(`support/api.ts`)。

- メール stub の読み出し。確認リンクの生トークンはメール本文にしか無く、stub に画面は無いため
- `staff-csv.spec.ts` の前準備。この spec が見たいのはスタッフ側の画面で、参加者側は `entry-flow.spec.ts` がブラウザで通している

## 設計上のポイント

### メールは stub で受ける

エントリー確認トークンは**リクエストごとに生成され、DB には SHA-256 ハッシュしか残りません**(`apps/backend/src/lib/token.ts`)。つまり生のトークンが現れるのはメール本文だけなので、テストがメールを読めないとフローが進みません。

そのため `apps/backend/src/lib/mailer.ts` に `MAIL_API_BASE_URL` バインディングを足し、`createMailSender()` 経由で送信先の API オリジンを差し替えられるようにしてあります。既定値は Resend 本体なので、本番の挙動は変わりません。

### セッション Cookie とプロトコル

ブラウザが直接触るのは `vite dev`(`http://127.0.0.1:5173`)だけです。`/api/*` は SSR なら `hooks.server.ts` の `handleFetch`、ブラウザからなら vite の dev proxy が Worker に転送します。セッション Cookie はフロントエンド側で自分のオリジンに発行し直され(`src/lib/server/backend-cookies.ts`)、その際 HTTP なら `Secure` が落ちるので、平文でも成立します。

以前は Worker を `--local-protocol https` で起動していました。Playwright の API request context が `Secure` Cookie を `http://` に送り返さず、認証付きのステップが**アプリ側に無い理由で**全部 401 になっていたためです。セッションをブラウザが持つようになった今その理由は無く、逆に自己署名証明書だと SvelteKit のサーバ側 `fetch` が全部落ちるので、平文の HTTP に戻してあります。

### フォームはハイドレーションを待ってから入力する

各フォームのテキスト入力は値を Svelte の式(`value={form?.email ?? ''}` など)から描画しています。つまりハイドレーションの瞬間にその式の値 — 未送信のフォームなら空文字 — がフィールドに上書きされるので、それより前に入力した内容は黙って消えます。消えた結果 `required` に引っかかって送信自体が起きず、「ボタンを押したのに何も起きない」という読みにくい失敗になります。

`support/ui.ts` の `waitForHydration()`(`networkidle` 待ち)と `fillField()`(入力後に値が残っているか確認する)がこれを防いでいます。

### シード

`support/global-setup.ts` が実行ごとに全テーブルを空にし、`support/fixtures.ts` の地域・大会・レギュレーション・フォーム項目定義・スタッフアカウントを固定 UUID で入れ直します。地域・大会・スタッフを作る API が無い(`docs/api-endpoints.md` の「未実装」節)ため、ここだけは Supabase の Data API を直接使っています。

大会は2つあり、テスト同士が干渉しないよう用途を分けています。

- `SAIKYOI`(定員 1): `waitlist-flow.spec.ts` 専用
- `SHINJINOU`(定員なし): それ以外

参加者のメールアドレスは毎回 UUID 付きで生成するので、同じスタックに対して繰り返し実行しても `participants.email` の unique 制約に当たりません。
