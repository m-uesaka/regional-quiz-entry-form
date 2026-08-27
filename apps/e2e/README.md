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
| `bunx wrangler dev --local-protocol https`(`https://127.0.0.1:8787`) | `apps/backend` の Worker |
| `bunx vite dev`(`http://127.0.0.1:5173`) | `apps/frontend` の SvelteKit アプリ。ブラウザが触るのはこちらだけで、`/api/*` は vite の dev proxy 経由で Worker に届く |

Supabase は起動しません(Docker イメージの取得を毎回のテスト実行に巻き込まないため)。起動していない場合は `support/seed.ts` が起動コマンドを添えて落ちます。

ブラウザは Chromium 1つだけ使います。`bunx playwright install chromium` を一度実行しておいてください(未取得だと Playwright が起動時にその旨で落ちます)。

### ローカルスタックは Postgres と Data API だけ

`supabase/config.toml` で **Auth (GoTrue) / Storage / Realtime を `enabled = false`** にしてあります。本プロジェクトはいずれも使っておらず(セッションはバックエンド自前の HS256 JWT、ファイルアップロードなし、realtime チャンネルなし)、有効にしたままだとコンテナを起動しなくても CLI がスキーマ用マイグレーションのためにイメージを取得してしまい、CI の `supabase start` が約 40 秒延びるためです。

そのため `bun run db:start` で立ち上がるのは Postgres / Kong / PostgREST の 3 つだけです。Studio(`http://127.0.0.1:54323`)は起動しますが、Authentication・Storage のページは対応するサービスが居ないためエラーになります。これらの機能を使う機能を実装することになったら、`supabase/config.toml` で該当サービスを `enabled = true` に戻してください(`.github/workflows/ci.yml` の `-x` にはこの 3 つを入れていないので、CI 側は自動的に追随します)。

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

ブラウザが直接触るのは `vite dev`(`http://127.0.0.1:5173`)だけです。`/api/*` は SSR なら `hooks.server.ts` の `handleFetch`、ブラウザからなら vite の dev proxy が Worker に転送します。

バックエンドは **`wrangler dev --local-protocol https`** で起動します(#91)。本番と同じく、フロントエンド → バックエンドのホップが TLS になります。バックエンドのセッション Cookie は `secure: true` 固定(`apps/backend/src/routes/*-auth.ts`)で、`Secure` は「その Cookie が実際に通ったホップ」を指す属性なので、平文で通していると本番と違う経路を見ていることになります。

セッション Cookie はフロントエンドが自分のオリジンに発行し直しますが、**2つの Cookie で経路が違い、`Secure` が落ちるのは片方だけです**。

| Cookie | 経路 | `Secure` |
| --- | --- | --- |
| `staff_session` | `forwardSetCookies()`(`src/lib/server/backend-cookies.ts`) | フロントエンドのプロトコルから判断するので HTTP では落ちる |
| `participant_session` | `forwardBackendCookies()`(`src/lib/server/backend-fetch.ts`、`handleFetch` から) | バックエンドの属性をそのまま写すので残る |

つまり `participant_session` がフロントエンドの平文オリジンで通るのは、Chromium が `127.0.0.1` を trustworthy origin とみなして `Secure` Cookie を受け取るからです。**ループバックである**ことが条件で、単に平文であればよいわけではありません。`vite dev --host` で LAN のアドレスに出すと、参加者ログインが黙ってログイン画面に戻り続けます。

### 自己署名証明書を通す3箇所

`wrangler dev --local-protocol https` が出す証明書は自己署名なので、Worker に触る3者それぞれに個別の許可が要ります。

| 触る側 | 通し方 | 場所 |
| --- | --- | --- |
| SvelteKit の SSR(`handleFetch`) | `NODE_TLS_REJECT_UNAUTHORIZED=0` | `playwright.config.ts` の `FRONTEND_ENV` |
| Playwright の `request` フィクスチャ(`support/api.ts`) | `use.ignoreHTTPSErrors` | `playwright.config.ts` |
| `webServer` の起動待ち(`/api/healthz`) | `webServer[].ignoreHTTPSErrors` | `playwright.config.ts` |

ブラウザからの `/api/*`(CSV ダウンロードリンク)は vite の dev proxy が `secure: false` で通すので、ここには出てきません。

`NODE_TLS_REJECT_UNAUTHORIZED=0` は**プロセス全体**の証明書検証を切ります。これが許されるのは、Playwright が `webServer.env` として渡す先が**このテスト実行が起動した `vite dev` プロセスだけ**で、開発者のシェルにも他のプロセスにも波及しないからです。リクエスト単位に証明書を受け入れる手段がランタイムの `fetch` に無い以上、代案は mkcert 等でローカル CA に信頼された証明書を配ることになりますが、CI を含む各環境のセットアップが増えるので採っていません。

なお、開発者が `apps/frontend/.env` の `BACKEND_URL` を HTTPS の dev サーバに向けた場合は、`bun run dev:frontend` でも同じ理由で全ページが 500 になります。テスト実行と違って許可を仕込む場所が無いので、そのときは `BACKEND_URL` を平文に戻すか、`NODE_TLS_REJECT_UNAUTHORIZED=0 bun run dev:frontend` のように自分のプロセスに閉じて渡してください。

### フォームはハイドレーションを待ってから入力する

各フォームのテキスト入力は値を Svelte の式(`value={form?.email ?? ''}` など)から描画しています。つまりハイドレーションの瞬間にその式の値 — 未送信のフォームなら空文字 — がフィールドに上書きされるので、それより前に入力した内容は黙って消えます。消えた結果 `required` に引っかかって送信自体が起きず、「ボタンを押したのに何も起きない」という読みにくい失敗になります。

`support/ui.ts` の `waitForHydration()`(`networkidle` 待ち)と `fillField()`(入力後に値が残っているか確認する)がこれを防いでいます。

### シード

`support/global-setup.ts` が実行ごとに全テーブルを空にし、`support/fixtures.ts` の地域・大会・レギュレーション・フォーム項目定義・スタッフアカウントを固定 UUID で入れ直します。地域・大会・スタッフを作る API が無い(`docs/api-endpoints.md` の「未実装」節)ため、ここだけは Supabase の Data API を直接使っています。

大会は2つあり、テスト同士が干渉しないよう用途を分けています。

- `SAIKYOI`(定員 1): `waitlist-flow.spec.ts` 専用
- `SHINJINOU`(定員なし): それ以外

参加者のメールアドレスは毎回 UUID 付きで生成するので、同じスタックに対して繰り返し実行しても `participants.email` の unique 制約に当たりません。
