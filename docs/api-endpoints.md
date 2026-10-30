# API エンドポイント

このドキュメントは `apps/backend`(Hono / Cloudflare Workers)が公開する HTTP API の一覧と、認証・エラー応答の共通仕様をまとめたものです。

- ルート定義の正本: `apps/backend/src/index.ts` と `apps/backend/src/routes/*.ts`
- リクエスト/レスポンスの型: `packages/shared/src/schemas/*.ts`(バックエンド/フロントエンド共通)
- テーブル構造: [`database-schema.md`](./database-schema.md)

## 1. 共通仕様

### ベースパス

すべてのルートは `/api` 配下にマウントされています(`new Hono<Env>().basePath('/api')`)。

### 型安全な呼び出し(Hono RPC)

バックエンドはルートをチェーンした結果を `export type AppType = typeof routes` として公開しています。フロントエンドは手書きの fetch ラッパーを作らず、`hono/client` の `hc<AppType>()` 経由で呼び出します。

```ts
// apps/frontend/src/lib/api.ts
export function createApiClient(fetchImpl: typeof fetch = fetch) {
  return hc<AppType>('/', {fetch: fetchImpl});
}

// 呼び出し例(SvelteKit の load 関数内)
const api = createApiClient(fetch);
const res = await api.api.tournaments[':regionSlug'][':tournamentSlug'].$get({
  param: {regionSlug, tournamentSlug},
});
```

パスパラメータの型もバックエンドの `zValidator` から推論されます。例えば `tournamentSlug` は `string` ではなく `'saikyoi' | 'shinjinou'` のリテラルユニオンなので、生のルートパラメータは `TournamentTypeSchema.safeParse()` などで絞り込んでから渡す必要があります。

### 認証方式

JWT を httpOnly Cookie に格納して送受信します。DB 上にセッションレコードは持ちません(`hono/jwt` の `sign` / `verify`、HS256、署名鍵は `SESSION_SECRET`)。

| Cookie 名 | 対象 | 有効期間 | クレーム |
| --- | --- | --- | --- |
| `staff_session` | スタッフ | 12 時間 | `sub`, `role`, `regionId`, `tournamentType`, `sessionsValidFrom`, `exp` |
| `participant_session` | 参加者 | 7 日間 | `sub`, `pwdChangedAt`, `iat`, `exp` |

Cookie 属性は `httpOnly` / `secure` / `sameSite: 'Lax'` です。

検証時の注意点として、`hono/jwt` の `verify()` は `exp` クレームが**存在するときだけ**期限を検証します。そのため各ミドルウェアは「`exp` が number であること」を明示的に確認しています。これがないと、`exp` を持たない正しく署名されたトークンが無期限のセッションとして通ってしまいます。

どちらのセッションも、署名の検証に加えて**リクエストごとに DB 参照が 1 回入ります**(セッションの失効)。

- **参加者**: `pwdChangedAt` はログイン時点の `participants.password_changed_at`(エポックミリ秒)で、`requireParticipant()` が毎リクエストその列を読み直し、**値が動いていたら 401** にします。パスワード再設定でこの列が更新されるため、再設定前に発行された Cookie(盗まれたものを含む)はその時点で使えなくなります。ステートレスな JWT のままだと、パスワードを変えても攻撃者のアクセスが最大 7 日間続いてしまいます。
- **スタッフ**(Task 11-3): `sessionsValidFrom` はログイン時点の `staff_accounts.sessions_valid_from`(エポックミリ秒)で、スタッフ用のミドルウェアすべて(`requireGeneralStaff()` / `requireStaffForTournament()` / `requireStaffForEntry()`、期間外の `requireOpenEntryPeriodOrStaff()`)が毎リクエストその列を読み直し、**値が動いていたら 401** にします。この列は統括スタッフの明示的な無効化(`POST /api/staff/accounts/:id/revoke-sessions`、12 章)とパスワード再設定(`reset_staff_password()`)で進みます。スタッフの Cookie は参加者全員の氏名・ふりがな・メールアドレスに届くので、漏れたときに 12 時間止められないことの影響は参加者セッションより大きく、列名を `password_changed_at` にしていないのは端末紛失・Cookie の漏洩などパスワード変更以外でも切れるようにするためです。ただし切れるのはセッションだけで、**パスワードを知っている人の再ログインは止められません**。締め出すにはアカウントを無効化します(`POST /api/staff/accounts/:id/disable`、12 章)。無効化されたアカウントのセッションは、この列の値にかかわらず 401 です(`staff_accounts.disabled_at` も同じ読み取りで見ています)。

どちらも、**列を読めなかったときは 401 ではなく 500** を返します。セッション自体は正しいかもしれず、DB 障害でログイン画面に追い返すべきではないためです。行が消えている(アカウント削除)場合は失効と同じく 401 です。`sessionsValidFrom` を持たない古いスタッフ Cookie(Task 11-3 以前に発行されたもの)はクレームの形の検証で落ち、未ログインと同じ扱いになります。

比較を「発行時刻より後か」ではなく**同じ列の値どうしの一致**にしているのは、Worker と Postgres の時計ずれで登録直後・再設定直後のログインが自分のセッションで 401 になるのを避けるためです。

### 認可ミドルウェア

`apps/backend/src/middleware/` に3種類のスタッフ用ミドルウェア、1種類の参加者用ミドルウェア、1種類のエントリー期間用ミドルウェアがあります。

| ミドルウェア | 条件 | 失敗時 |
| --- | --- | --- |
| `requireGeneralStaff()` | 有効で失効していない `staff_session` かつ `role === 'general'` | 401 / 403 / 500 |
| `requireStaffForTournament()` | 有効で失効していない `staff_session`。`general` なら無条件通過、`regional` なら `:tournamentId` の大会が担当範囲(`region_id` と `type` が両方一致)であること。統括スタッフでも大会は読み、存在しなければ 404 | 401 / 403 / 404 / 500 |
| `requireStaffForEntry()` | 同上。ただし `:entryId` から `tournament_id` を辿って範囲を判定する | 401 / 403 / 500 |
| `requireParticipant()` | 有効な `participant_session`。加えて `pwdChangedAt` クレームが `participants.password_changed_at` と一致すること(パスワード再設定でセッションが切れる) | 401 / 500 |
| `requireOpenEntryPeriodOrStaff()` | エントリー期間中なら**誰でも通過**。期間外は担当スタッフ(`general`、または `region_id` と `type` が一致する `regional`)のみ | 401 / 403 / 404 / 500 |

スタッフ用の3つは同じ関数(`authenticateStaff()`)で Cookie を読み、失効の確認(`staff_accounts` の読み取り)と範囲の確認(大会・エントリーの読み取り。`requireStaffForEntry()` は `regional` の場合のみ)を**並行して**行います。どちらも問題があるときは**失効の 401 が優先**です。失効したセッションは担当範囲にかかわらず死んでいるので、スタッフ画面がログイン画面へ戻せるようにするためです。`requireStaffForTournament()` は `general` を含む**全ロールで** `tournaments` 行を1回読み、通過したら `c.set('tournament', ...)` でハンドラへ渡します(#123。ハンドラは同じ大会を読み直さない)。大会が存在しない場合、`general` には 404 `{"error": "tournament not found"}` を返し、`regional` には担当外と同じ 403 を返します(存在の有無で応答を変えると、担当外の id が存在するかを探れてしまうため)。

#### `requireOpenEntryPeriodOrStaff()`(エントリー期間外アクセス制御)

要件の「エントリーフォームの URL は、エントリー期間中はオープンアクセス、期間外は地域スタッフ及び統括スタッフのみアクセス可能」(`requirements.md`)を **API 側で**担保するミドルウェアです。この判定は以前 SvelteKit の `load` にしか無く、Worker を直接叩けばフォームの中身が誰でも読めていました。

フォームを構成する3つの公開 GET に付けています。

- `GET /api/tournaments/:regionSlug/:tournamentSlug`
- `GET /api/tournaments/:tournamentId/regulations`
- `GET /api/form-definitions/:tournamentId`

判定は次の順です。

1. リクエストが指す大会を引く(`:tournamentId` から直接、または `:regionSlug` / `:tournamentSlug` から `regions!inner()` で絞った1回のクエリで)。見つからなければ **404** `{"error": "tournament not found"}`
2. `isAcceptingEntries()`(`packages/shared`。期間内で、かつ一時中断(`entries_paused`、`0039`)されていない)が真なら、セッションを見ずに通過
3. 受付中でなければ `staff_session` を読む。`staff_session` が**付いているのに検証できなかった**場合(期限切れ・改竄)は **401** `{"error": "staff session expired"}`。セッションが切れただけのスタッフをログイン画面に戻すためで、セッションを最初から持たない訪問者(4 の 403)と区別する必要があるのはこの点です
4. セッションが無ければ **403** `{"error": "entry period closed"}`。期間内だが一時中断中のときは `{"error": "entries paused"}`(フォーム側で「一時中断しています」と出し分けるため。6 も同じ)
5. セッションの失効を確かめる(`staff_accounts.sessions_valid_from`)。失効していれば 3 と同じ **401** `{"error": "staff session expired"}`、列を読めなければ **500**
6. 担当スタッフでなければ **403** `{"error": "entry period closed"}`

失効の確認を範囲の確認より先にしているのは、スタッフ用ミドルウェアと同じ理由です。失効したセッションは対象の大会にかかわらず死んでいるので、他地域のフォームを開いた場合でも 403 ではなく 401 で返し、ログイン画面に戻します。

「スタッフであること」では足りない点が要点です。担当外の地域スタッフには、他地域の未公開フォームを読む理由がありません。範囲の規則は `packages/shared/src/logic/staff-scope.ts` の `canPreviewTournament()` にあり、バックエンドの `isInScope()` とフロントエンドのエントリーページ `load` が**同じ関数**を使います。

401 を分けるのはフロントエンドの都合です。スタッフ画面は `hooks.server.ts` が読んだクレームを見てから API を叩くので、そこで弾けないのは「クレーム確認の直後にトークンが失効した」場合だけです。これを 403 で返すと、担当範囲は正しいのに「権限がありません」で行き止まりになります。

公開エントリーリスト(§8)には**掛けていません**。エントリーリストは公開された結果であり、最も読まれるのは期間が終わった後だからです。そのためリスト画面用にスラッグ引きの `GET /api/tournaments/:regionSlug/:tournamentSlug/entry-list` を用意しています(大会取得 API 経由で UUID を解決すると、期間終了後にこのゲートに阻まれるため)。

引いた行はコンテキスト変数 `tournament` に載せるので、その後ろのハンドラ(大会取得 API)は同じ大会をもう一度引きません。

> **ルーティング上の注意**: `routes/tournaments.ts` はミドルウェアを `.use('*', ...)` ではなく**ルート単位**で付けています。このサブアプリは `/tournaments` にマウントされており、同じ `/tournaments` に公開ルート(`routes/entries.ts` / `routes/entry-list.ts`)もマウントされているためです。Hono はミドルウェアを「どのサブアプリで登録されたか」ではなく**リクエストの最終パス**でマッチさせるので、ワイルドカードを使うと公開ルートまで認証必須になってしまいます。

> **登録順の依存**: `index.ts` では `entryListRoute` を `tournamentsRoute` より先にマウントしています。`GET /tournaments/:tournamentId/entry-list` と `GET /tournaments/:regionSlug/:tournamentSlug` はどちらも2セグメントのパターンなので、順序を入れ替えると公開エントリーリストが大会取得ルートに吸われます。

### レート制限と Turnstile

未認証で叩ける 5 本には、Cloudflare の Rate Limiting binding によるレート制限が掛かっています(#116 / [Task 11-1](../tasks/task-11-1.md))。**IP とメールアドレスの 2 つの鍵**で別々に数えます(IP の決め方は下記「IP 鍵の IP」)。1 つの IP から多数のアカウントを試す攻撃は IP 鍵でしか、多数の IP から 1 アカウントを試す攻撃はメール鍵でしか止まらないためです。メール鍵はバリデーション通過後に数えるので、スキーマに合わない本文で他人のメール枠を減らすことはできません。また鍵に載せる前に**小文字化**します(`middleware/rate-limit.ts` の `emailKey()`)。`Victim@example.com` と `victim@example.com` は同じ受信箱なので、そのまま数えるとバケツが分かれ、大文字小文字を変えた分だけ上限を取り直せてしまうためです。

**IP 鍵の IP**(`middleware/rate-limit.ts` の `clientIp()`、#188): ログイン・エントリー送信・パスワード再設定申請はフロントエンドのフォーム action から送られるので、バックエンドには SvelteKit の SSR(`hooks.server.ts` の `handleFetch`)からのサブリクエストとして届きます。このとき `CF-Connecting-IP` に入るのは利用者ではなくフロントエンド側のアドレスなので、そのまま数えると全利用者が 1 つのバケツを共有してしまいます。そこでフロントエンドは `event.getClientAddress()` を `X-Client-IP` に、共有シークレット `CLIENT_IP_FORWARD_SECRET` を `X-Client-IP-Forward-Secret` に載せて転送し、バックエンドは**シークレットが一致したとき(定数時間比較)だけ** `X-Client-IP` を採用します。一致しない・送られていない・バックエンド側でシークレット未設定のときはヘッダーを無視し、従来どおり `CF-Connecting-IP`(無ければ `unknown`)で数えます。フロントエンドはリクエストに元から付いていた同名のヘッダーを転送前に必ず消すので、ブラウザが値を差し込むことはできません。利用者の IP が取れないとき(prerender 中や、エッジを通らないリクエスト)は何も転送しません。シークレットを載せたリクエストはリダイレクトを追わない(`redirect: 'manual'`)ので、別オリジンへシークレットが渡ることもありません。ヘッダー名は `packages/shared` の `CLIENT_IP_HEADER` / `CLIENT_IP_FORWARD_SECRET_HEADER` を両側で使います。

IP 鍵は、IPv4 はアドレスそのまま、IPv6 は**先頭 /64**(`2001:db8:0:1::/64` の形に正規化)で数えます。通常の回線には /64 がまるごと割り当てられるので、アドレス単位だと 1 人がリクエストごとに別のバケツを使えてしまうためです。IPv4 射影アドレス(`::ffff:192.0.2.1`)は IPv4 として数えます。

`X-Client-IP` が届いたのにシークレットが一致しない場合(バックエンド側にシークレットが設定されているときのみ)は、`console.warn` で警告を出します(シークレットの値は出しません)。これが出ていれば、Worker と Pages のシークレットがずれていて、全利用者が 1 つのバケツを共有している状態です。Service Binding ではなく共有シークレットにしたのは、`vite dev` / E2E を含めてどこでも同じ `fetch(BACKEND_URL)` 1 本の経路で済むためです。

**鍵ごとに別の limiter に載せています。** Rate Limiting binding は上限を binding 単位でしか持てないので、IP 鍵とメール鍵に別々の数字を与えるには binding を分けるしかありません。

| エンドポイント | 鍵 | limiter | 上限(本番) | Turnstile |
| --- | --- | --- | --- | --- |
| `POST /api/auth/staff/login` | `ip:` | `LOGIN_IP_RATE_LIMITER` | 10 回 / 60 秒 | なし |
| `POST /api/auth/staff/login` | `staff-login:email:` | `LOGIN_EMAIL_RATE_LIMITER` | 60 回 / 60 秒 | なし |
| `POST /api/auth/participant/login` | `ip:` | `LOGIN_IP_RATE_LIMITER` | 10 回 / 60 秒 | なし |
| `POST /api/auth/participant/login` | `participant-login:email:` | `LOGIN_EMAIL_RATE_LIMITER` | 60 回 / 60 秒 | なし |
| `POST /api/tournaments/:tournamentId/entries` | `ip:` | `MAIL_TRIGGER_IP_RATE_LIMITER` | 20 回 / 60 秒 | **必須** |
| `POST /api/tournaments/:tournamentId/entries` | `email:` | `MAIL_TRIGGER_EMAIL_RATE_LIMITER` | 3 回 / 60 秒 | **必須** |
| `POST /api/tournaments/:tournamentId/entries/session` | `ip:` | `MAIL_TRIGGER_IP_RATE_LIMITER` | 20 回 / 60 秒 | **必須** |
| `POST /api/auth/participant/password-reset/request` | `ip:` | `MAIL_TRIGGER_IP_RATE_LIMITER` | 20 回 / 60 秒 | **必須** |
| `POST /api/auth/participant/password-reset/request` | `email:` | `MAIL_TRIGGER_EMAIL_RATE_LIMITER` | 3 回 / 60 秒 | **必須** |
| `POST /api/auth/staff/password-reset/request` | `ip:` | `MAIL_TRIGGER_IP_RATE_LIMITER` | 20 回 / 60 秒 | **必須** |
| `POST /api/auth/staff/password-reset/request` | `staff-password-reset:email:` | `MAIL_TRIGGER_EMAIL_RATE_LIMITER` | 3 回 / 60 秒 | **必須** |

メール送信の各エンドポイントでは、**厳しい数字は宛先(メール鍵)の側だけ**に置いています。抑えたいのは「1 つの受信箱をどれだけ消費できるか」だからです。IP 鍵の方を緩くしてあるのは、IP が 1 人とは限らないためです — エントリー開始時刻に部活動や学校の NAT・キャリアの CGNAT の裏から複数人が申し込むのは普通のことで、しかも IP 制限は Turnstile とバリデーションより**前**に評価されるので、メールを送るはずのなかった試行まで枠を消費します。3 回 / 60 秒だと 4 人目以降が「本人にはどうしようもない 429」を踏みます。スクリプトが実際に越えなければならないのはこの数字ではなく前段の Turnstile です。

ログインの IP 鍵は**エンドポイント名を含みません**。これが抑えているのは「その発信元が Worker に踏ませる PBKDF2 の量」であり、2 本のどちらを叩こうと同じ CPU だからです。一方**メール鍵にはエンドポイント名を入れます**(`participant-login:` / `staff-login:`。パスワード再設定ではスタッフ側だけ `staff-password-reset:`)。同じアドレスを参加者とスタッフの両方が持ち得るので、共有すると未認証で叩ける参加者ログインからスタッフの枠を削れてしまいます。

超過時は **`429` と `Retry-After: 60`**、本文は `{"error": "too many requests"}` です。フロントエンドは「送信が集中しています。しばらく待ってから再度お試しください」と表示します。

**アカウントロックアウト(N 回失敗でアカウントを止める)は採っていません。** メールアドレスさえ分かれば任意の参加者を締め出せる DoS になるため、単位時間あたりの試行回数だけを制限します。

とはいえ**メールアドレスを鍵にした制限は、それ自体がその持ち主を締め出す手段になります**(枠を埋め続ければよい)。そのためログインのメール鍵は、正規の利用者がまず到達しない 60 回 / 60 秒に緩めてあります。10 回 / 60 秒なら 6 秒に 1 回の送信で恒久的に締め出せるところ、毎秒 1 回の送信を維持しないと同じことができない、というトレードオフです(1 アカウントに対する総当たりの上限としては緩くなります)。厳しい数字は、締め出される相手と枠を使う相手が一致する IP 鍵の側に置いています。

メールを送る 2 本は、上記に加えて **Turnstile のトークン**を要求します。トークンはリクエストボディではなく **`cf-turnstile-response` ヘッダ**で受け取ります(送信のたびに使い捨てるものなので、`packages/shared` のスキーマ — マイページの編集フォームや DB への insert も組み立てる — には入れません)。フロントエンドはウィジェットがフォームに差し込む同名の hidden control を読み、ヘッダに載せ替えます。載せる前に `$lib/turnstile.ts` の `readTurnstileToken()` を通し、**HTTP ヘッダに載らない値(改行・制御文字・非 ASCII・極端に長い値)は空文字に落とします**。フォームアクションには直接 POST できるので、この control の値は呼び出し側の任意です。そのまま渡すと `new Request()` が `TypeError` を投げ、Turnstile が返すべき 400 ではなく 500 のエラーページになります。空文字はトークン無しと同じ扱い(fail closed の 400)です。

検証は `lib/turnstile.ts` の `verifyTurnstile()` が Cloudflare の siteverify API に対して行い、**トークンが無い場合・無効な場合・siteverify に到達できない場合のいずれも 400 `{"error": "turnstile verification failed"}`** で落とします(fail closed)。Cloudflare 側の一時障害で素通しになると、そのままメール爆撃の口が開くためです。3 者を区別しないのは、どれも「もう一度ウィジェットを解いてやり直す」で直るからです。

**トークンは使い捨てです。** siteverify に一度通したトークンを再送すると Cloudflare は `timeout-or-duplicate` を返すため、この 2 本のフォームは送信が拒否された(429・401・400 など何であれ)たびにウィジェットを描き直します。フロントエンドの 2 つのフォームは `use:enhance` + `fail()` でその場に再描画されるだけなので、放っておくと hidden control に使用済みトークンが残り、次の送信が「本当の失敗理由」ではなく Turnstile の 400 で落ちてしまいます。`$lib/components/Turnstile.svelte` が `reset()` を公開し、各フォームの `enhance` コールバックがこれを呼びます。

### CSRF 対策(Origin 検証)とセキュリティヘッダ

(#120 / [Task 11-5](../tasks/task-11-5.md))

以前は、別サイトからのフォーム送信を防いでいたのが「セッション Cookie が `SameSite=Lax` であること」と「API が CORS ヘッダを一切返さないこと」という、どこにも書かれていない 2 つの条件だけでした。`cors()` を足す、Cookie を `SameSite=None` にする、のどちらかで黙って無防備になるため、`index.ts` で **`hono/csrf` による Origin 検証を全ルートに明示的に掛けています**。

- 対象は、ブラウザが別サイトのページからでもプリフライト無しで送れてしまうリクエスト、つまり **GET / HEAD / OPTIONS 以外で、`Content-Type` が `application/x-www-form-urlencoded` / `multipart/form-data` / `text/plain` のもの(`Content-Type` 無しも含む)**です。ボディの無い `POST .../logout`、`POST /api/staff/accounts/:id/revoke-sessions`、`DELETE /api/mypage/entries/:entryId` などがこれに当たります
- これらは **`Sec-Fetch-Site: same-origin` か、`Origin` が `FRONTEND_URL`(と、設定されていれば `CSRF_TRUSTED_ORIGINS` に並べたもの)のオリジンと一致する場合だけ**通し、それ以外は `403`(本文はプレーンテキストの `Forbidden`)を返します。`FRONTEND_URL` が URL として読めない場合も通しません(fail closed)。許可するオリジンの集合は、バインディングが変わらない限り 1 度だけ組み立てて使い回します
- JSON ボディ(`application/json`)は検証しません。別サイトのページから JSON を送るには CORS のプリフライトが要り、この API はそれに応えないためです。**将来 `cors()` を足すときは、許可するオリジンをこの前提ごと見直してください**

正規の呼び出し経路はすべてこの検証を通ります。

| 経路 | 通る理由 |
| --- | --- |
| ブラウザからの `/api/*`(本番は Workers route、`vite dev` は dev proxy 経由) | フロントエンドと同一オリジンなので `Sec-Fetch-Site: same-origin` が付く |
| SSR(`load` / form action)からの呼び出し | `hooks.server.ts` の `handleFetch` が Worker に転送する際、SvelteKit のサーバー側 `fetch` がページ自身のオリジン(= `FRONTEND_URL`)を `Origin` に入れる |
| E2E(`apps/e2e`) | `playwright.config.ts` が `FRONTEND_URL` に `vite dev` のオリジン(`http://127.0.0.1:5173`)を `--var` で渡している。テストが Worker を直接叩くのは JSON の POST だけ |
| ローカル開発(`bun run dev:backend`) | `apps/backend/package.json` の `dev` スクリプトが `--var` で `FRONTEND_URL=http://localhost:5173` と `CSRF_TRUSTED_ORIGINS=http://127.0.0.1:5173` を渡す。別のホスト・ポートで動かすときは `bunx wrangler dev --var ...` で自分の値を渡す。`wrangler.toml` 最上位の `FRONTEND_URL` は本番の値のまま(`--env` 無しの `wrangler deploy` が本番 Worker を上書きするため、ここにローカル用の値を置かない) |

したがって **`FRONTEND_URL` は「メール本文のリンク」だけでなく「状態変更を許すオリジン」でもあります**。staging / production では `deploy.yml` が `FRONTEND_HOST` から設定するので、`FRONTEND_HOST` 未設定のまま `*.pages.dev` のオリジンでフロントエンドを開くと、ログアウト等のボディ無し POST が 403 になります。プレビュー環境など別のアドレスでも使う場合は、そのオリジンを `CSRF_TRUSTED_ORIGINS`(カンマ区切り)に追加します([`supabase-deployment.md`](./supabase-deployment.md) 6.4 / 6.6)。

**セキュリティヘッダ。** バックエンドは `hono/secure-headers` の `secureHeaders()` を全応答(403 などのエラー応答を含む)に付けます(`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: no-referrer`、`Strict-Transport-Security` など、ライブラリ既定のまま)。

フロントエンドのページ応答には次を付けます(`apps/frontend/src/lib/server/security-headers.ts` と `vite.config.ts` の `csp`)。

| ヘッダ | 対象 | 値 |
| --- | --- | --- |
| `Content-Security-Policy` | 全ページ | SvelteKit の `csp`(`mode: 'auto'`)が生成。インラインの起動スクリプトはリクエストごとの nonce で許可し、`script-src` / `frame-src` には Turnstile の `https://challenges.cloudflare.com` を加える。`style-src` は style 属性のため `'unsafe-inline'`。`frame-ancestors 'none'`、`form-action 'self'`、`object-src 'none'`、`base-uri 'self'` |
| `X-Content-Type-Options` | 全ページ | `nosniff` |
| `Referrer-Policy` | 全ページ(下記を除く) | `strict-origin-when-cross-origin`(別サイトにはオリジンのみ) |
| `Referrer-Policy` | `?token=` 付きの `/verify`・`/password-reset`・`/staff/password-reset`(いずれもトークンを取り除く 303 リダイレクトの応答) | `same-origin`(別サイトには Referer を一切送らない) |
| `Cache-Control` | `/mypage`・`/staff`・`/admin` 配下、`?token=` 付きの上記 3 ページ、および**全ページの GET 以外の応答**(フォーム送信の結果。公開エントリーフォームの送信結果には氏名・メールアドレスが載るため) | `private, no-store`(共有キャッシュにも bfcache にも残さない)。公開エントリーリストやエントリーフォーム自体の GET は対象外 |

**`no-referrer` を使っていないのは意図的です。** `Referrer-Policy: no-referrer` のページから送られたフォーム送信(JavaScript 無しの通常の POST)には、ブラウザが `Origin: null` を付けます。SvelteKit 自身の CSRF チェックはこれを別サイトからの送信とみなして 403 を返すため、ハイドレーション前や JavaScript 無しでも送れるようにしてあるフォーム(#95)が壊れます。トークン付きページの `same-origin` は、外部サイトへの Referer を止めるという目的は `no-referrer` と同じで、自サイトへのフォーム送信の `Origin` は残ります。また Turnstile は別オリジンの iframe なので、全ページを `same-origin` にはしていません。

**トークンを URL から消す。** パスワード再設定の 2 ページ(`/password-reset`・`/staff/password-reset`)は、`?token=` 付きで開かれると `load` がトークンを**そのページのパスに限定した httpOnly Cookie**(`SameSite=Lax`、有効期限はバックエンドのトークンと同じ 1 時間 / 24 時間)に移し、`?token=` を除いた URL へ 303 でリダイレクトします(`apps/frontend/src/lib/server/reset-token.ts`)。以降トークンは Cookie にしか無く、アドレスバー・履歴・ページの HTML・シリアライズされた `load` データのどれにも載りません。再読み込みやブラウザによるタブの復元でもリンクはそのまま使え、JavaScript も要りません。設定が完了したとき、または API がトークンを拒否したときに Cookie を消し、拒否された場合は再設定フォームの代わりに(参加者は)リンクの再送フォームを出します。エントリー確認の `/verify` も同じ仕組みでトークンを Cookie に移します(トークンを消費するのはページを開いたときではなく、ボタンの form action です。#190)。

### エラー応答の形式

エラーは基本的に `{"error": "メッセージ"}` の形です。ただし `@hono/zod-validator` によるバリデーション失敗だけは例外で、ライブラリ既定の `{"success": false, "error": <ZodError>}` が 400 で返ります。

成功か失敗かの判定には `res.ok` / `res.status` をそのまま使って構いません。問題はエラー側の内訳で、400 は文字列エラー(`{"error": "メッセージ"}`)と Zod のバリデーションエラー(`{"success": false, "error": <ZodError>}`)の**どちらでも返りうる**ため、ステータスだけでは2つのエラー形式を区別できません。しかもこの2つは構造的に重なっている(どちらも `error` フィールドを持つ)ので、本文を読むときは**フィールドの有無と型**で絞り込んでください。

```ts
const body = await res.json();
if ('yaml' in body) {
  previewYaml = body.yaml;
} else if ('error' in body && typeof body.error === 'string') {
  previewError = body.error;
}
```

## 2. エンドポイント一覧

「認可」列が「なし」(または「期間中はなし」)で始まる行は、無認証で到達できるルートです。この表は登録済みのルート、および `apps/backend/src/routes-authz.test.ts` の認可方針(`ROUTE_POLICIES`)と**一致することをテストで確かめています**(「なし」→ 公開、「期間中はなし」→ 期間ゲート、「統括スタッフ」「スタッフ(担当範囲)」「参加者」→ それぞれのガード)。ルートを足したら、この表にも行を足してください(理由は [`database-schema.md`](./database-schema.md) 4 章)。

| メソッド | パス | 認可 |
| --- | --- | --- |
| GET | `/api/healthz` | なし |
| POST | `/api/auth/staff/login` | なし(レート制限) |
| POST | `/api/auth/staff/password-reset/request` | なし(レート制限 + Turnstile) |
| POST | `/api/auth/staff/password-reset/confirm` | なし(トークン) |
| POST | `/api/auth/staff/logout` | なし(Cookie を消すだけ) |
| POST | `/api/auth/participant/login` | なし(レート制限) |
| POST | `/api/auth/participant/logout` | なし(Cookie を消すだけ) |
| POST | `/api/auth/participant/password-reset/request` | なし(レート制限 + Turnstile) |
| POST | `/api/auth/participant/password-reset/confirm` | なし(トークン) |
| GET | `/api/regions` | 統括スタッフ |
| POST | `/api/regions` | 統括スタッフ |
| PATCH | `/api/regions/:id` | 統括スタッフ |
| GET | `/api/tournaments` | 統括スタッフ |
| GET | `/api/tournaments/:id` | 統括スタッフ |
| POST | `/api/tournaments` | 統括スタッフ |
| PATCH | `/api/tournaments/:id` | 統括スタッフ |
| DELETE | `/api/tournaments/:id` | 統括スタッフ |
| PUT | `/api/tournaments/order` | 統括スタッフ |
| POST | `/api/tournaments/:id/reset` | 統括スタッフ |
| GET | `/api/tournaments/:regionSlug/:tournamentSlug` | 期間中はなし / 期間外は担当スタッフ |
| GET | `/api/tournaments/:tournamentId/regulations` | 期間中はなし / 期間外は担当スタッフ |
| PUT | `/api/tournaments/:tournamentId/regulations` | 統括スタッフ |
| GET | `/api/tournaments/:tournamentId/entry-list` | なし |
| GET | `/api/tournaments/:regionSlug/:tournamentSlug/entry-list` | なし |
| GET | `/api/tournaments/:tournamentId/entry-counts` | なし |
| POST | `/api/tournaments/:tournamentId/entries` | なし(レート制限 + Turnstile) |
| POST | `/api/tournaments/:tournamentId/entries/session` | 参加者(レート制限 + Turnstile) |
| POST | `/api/entries/verify` | なし(トークン) |
| GET | `/api/form-definitions/:tournamentId` | 期間中はなし / 期間外は担当スタッフ |
| PUT | `/api/form-definitions/:tournamentId` | 統括スタッフ |
| POST | `/api/sheet-import/preview` | 統括スタッフ |
| POST | `/api/sheet-import/regulations/preview` | 統括スタッフ |
| POST | `/api/sheet-import/tournaments/preview` | 統括スタッフ |
| POST | `/api/sheet-import/tournaments` | 統括スタッフ |
| GET | `/api/staff/tournaments/:tournamentId/entries` | スタッフ(担当範囲) |
| PUT | `/api/staff/tournaments/:tournamentId/entry-pause` | スタッフ(担当範囲) |
| GET | `/api/staff/tournaments/:tournamentId/entries.csv` | スタッフ(担当範囲) |
| GET | `/api/staff/entries/:entryId` | スタッフ(担当範囲) |
| POST | `/api/staff/tournaments/:tournamentId/mail` | スタッフ(担当範囲) |
| POST | `/api/staff/tournaments/:tournamentId/verification-mail` | スタッフ(担当範囲) |
| GET | `/api/staff/tournaments/:tournamentId/mail/:jobId` | スタッフ(担当範囲) |
| GET | `/api/staff/dashboard` | 統括スタッフ |
| GET | `/api/staff/accounts` | 統括スタッフ |
| POST | `/api/staff/accounts` | 統括スタッフ |
| POST | `/api/staff/accounts/:id/password-reset` | 統括スタッフ |
| POST | `/api/staff/accounts/:id/revoke-sessions` | 統括スタッフ |
| POST | `/api/staff/accounts/:id/disable` | 統括スタッフ |
| POST | `/api/staff/accounts/:id/enable` | 統括スタッフ |
| GET | `/api/mypage/entries` | 参加者 |
| GET | `/api/mypage/entries/:entryId` | 参加者(本人) |
| PATCH | `/api/mypage/entries/:entryId` | 参加者(本人) |
| DELETE | `/api/mypage/entries/:entryId` | 参加者(本人) |
| GET | `/api/portal/tournaments` | なし |

## 3. ヘルスチェック

### `GET /api/healthz`

疎通確認用。`200 {"ok": true}` を返すだけです。

## 4. 認証

### `POST /api/auth/staff/login`

スタッフのログイン。成功時に `staff_session` Cookie を発行します。

- リクエスト: `StaffLoginInputSchema` — `{email: string(email), scope: "saikyoi" | "shinjinou" | "general", password: string(min 1, max 1024)}`(ログインには下記のパスワードポリシーを**適用しません**。ポリシー導入前に設定したパスワードでもログインできる必要があるためです。上限も新規設定時の 256 文字より緩い 1024 文字(`LOGIN_PASSWORD_MAX_LENGTH`)にしています。256 文字の上限ができる前は上限が無かったためで、上限自体は PBKDF2 の計算量を守るために残しています)
- `200`: `StaffLoginResponseSchema` — `{"ok": true, "role": "regional" | "general", "regionSlug": string | null, "tournamentType": "saikyoi" | "shinjinou" | null}`
- `401`: `{"error": "invalid credentials"}`
- `429`: `{"error": "too many requests"}`(`Retry-After: 60`。1 章「レート制限と Turnstile」を参照)
- `500`: `{"error": "internal server error"}`

スタッフアカウントは**メールアドレスと担当種別の組**で 1 つに決まります(#166)。同じ地域の最強位と新人王を同じ人が同じアドレスで担当することがあり、それぞれ別のアカウントになるためです。`scope` はどのアカウントでログインするかで、地域スタッフは担当種別(`saikyoi` / `shinjinou`)、統括スタッフは `general` を選びます。`(email, tournament_type)` の一意制約(統括スタッフは `tournament_type` が null)があるので、どの組み合わせでも該当は高々 1 行です。

**無効化されたアカウント(#156)は探しません。** パスワードが正しくても、未登録のアドレスと同じ 401 になります。

`email` は**小文字にしてから**照合します(`packages/shared/src/schemas/email.ts` の `emailAddressSchema()`、#133)。参加者側のログイン・再設定要求・エントリーも同じです。

該当アカウントが存在しない場合もダミーのハッシュ(`lib/password.ts` の `DUMMY_PASSWORD_HASH`。現行の反復回数で作った形式なので、新規ハッシュと同じコストがかかります)に対して PBKDF2 を実行してから 401 を返します。これにより「メールアドレスが存在しない」場合と「パスワードが違う」場合の応答時間が揃い、タイミング差からのアカウント列挙を防ぎます。

ログインに成功したとき、保存されているハッシュが旧形式・旧パラメータ(`verifyPassword()` の `needsRehash`)なら、**その場で現行パラメータのハッシュに書き換えます**。平文が手元にあるのは照合が通ったこの瞬間だけなので、利用者に何も求めずに移行を進められます。書き換えは `waitUntil()` で応答の後に行い、失敗してもログは残してログイン自体は成功させます(次回のログインで再試行されます)。`password_hash` が照合時の値のままである行だけを更新するので、その間に再設定されたパスワードを古いもので上書きすることはありません。`password_changed_at` は動かしません(パスワードは変わっていないので、セッションを切る理由がないためです)。仕組みの詳細は [`database-schema.md`](./database-schema.md#participants--参加者アカウント) を参照してください。

`regionSlug` / `tournamentType` は `regional` スタッフの担当範囲で、`general` スタッフでは両方 `null` です。スタッフ画面は `/staff/{regionSlug}/{tournamentType}/entries` のように**スラッグ**で引くため、JWT クレームが持つ `regionId` ではなく `regions` を join したスラッグを返しています。ログイン画面(`/staff/login`)はこれを見て、`general` を `/staff/dashboard` へ、`regional` を担当大会のエントリー一覧へリダイレクトします。

### `POST /api/auth/staff/password-reset/request`

パスワードを忘れたスタッフが、自分で再設定リンクを申し込みます(#175)。参加者側の `POST /api/auth/participant/password-reset/request` のスタッフ版で、防御(レート制限 + Turnstile、`waitUntil()` による応答時間の平準化、登録の有無によらず同じ応答)も同じです。

- リクエスト: `StaffPasswordResetRequestInputSchema` — `{email: string(email), scope: 'saikyoi' | 'shinjinou' | 'general'}`、および `cf-turnstile-response` ヘッダ。1 つのアドレスが最強位・新人王の 2 アカウントを持ち得るため(#166)、ログインと同じく `scope` でアカウントを指定します
- `200`: `{"ok": true}`
- `400`: 本文が不正(zValidator)、または `{"error": "turnstile verification failed"}`
- `429`: `{"error": "too many requests"}`(`Retry-After: 60`)

`lib/staff-password-reset.ts` の `requestStaffPasswordReset()` が、該当する**無効化されていない**アカウントがあれば `sendStaffPasswordLink()` で有効期限 **1 時間**のリンクを `FRONTEND_URL/staff/password-reset?token=...` 宛てに送ります(統括スタッフが発行する招待・再発行リンクは 24 時間。本人が待っているリンクなので参加者側と同じ長さにしています)。招待済みでまだパスワードを設定していないアカウントも対象で、新しいリンクを自分で取り直せます。アカウントの検索はログインと同じ `findStaffAccountByScope()`(`lib/staff-account-lookup.ts`)です。

リンクの書き込みは、統括スタッフの発行(`issue_staff_password_link()`。既存のリンクをすべて消してから書く)とは別の `add_staff_password_link()`(`0031`)が行い、**既存の有効なリンクは消さずに書き足します**。この申し込みは未認証で誰でも行えるので、既存のリンクを消すと、アドレスと区分を知っている人が申し込みを繰り返すだけで、統括スタッフが送ったばかりの 24 時間の招待を 1 時間のリンクに置き換え続けられてしまうためです。どのリンクを使っても、パスワードを設定した時点で `reset_staff_password()` が残りをすべて使用済みにします。申し込みのたびに 1 行増えるので、そのアカウントの期限切れのリンクは同じ関数で削除します。

フロントエンドの `/staff/password-reset` は、トークンの Cookie(招待に合わせて 24 時間)が無効になったリンクのものでも区別できないため、`?request` で開くと Cookie を消して申し込みフォームを表示します。スタッフログイン画面の「パスワードを忘れた場合」と、パスワード入力フォームの「新しいリンクを申し込む」はこの URL を開きます。

### `POST /api/auth/staff/password-reset/confirm`

スタッフが招待メール(`POST /api/staff/accounts`)・リンク再発行(`POST /api/staff/accounts/:id/password-reset`)・本人の申し込み(上記 `/request`)で受け取ったトークンを使い、自分のパスワードを設定します。

- リクエスト: `StaffPasswordResetConfirmInputSchema` — `{token: string(min 1), newPassword: PasswordSchema}`(`PasswordSchema` は `packages/shared/src/password-policy.ts`。8 文字以上 256 文字以内で、よく使われるパスワードの一覧(約 3,300 件、大文字小文字を区別しない)に載っていないこと。記号必須などの文字種の強制はしません。よく使われるパスワードの一覧は約 30 KB あるため、ブラウザのバンドルに入らないようパッケージの `index.ts` からは export せず、サーバー側のコードだけが `@regional-quiz/shared/password-policy` から import します。パスワードを設定するフォーム(エントリー・参加者/スタッフのパスワード再設定)は、送信前に受け付けられるかを表示するため(#177、`PasswordRequirements.svelte`)、照合だけを持つ `@regional-quiz/shared/common-passwords` を動的 `import()` で読み込みます。一覧はそのフォームのページでだけ取得される別チャンクになり、最初のバンドルには入りません)
- `200`: `{"ok": true}`
- `400`: `{"error": "invalid or expired token"}`(未知・使用済み・期限切れのトークン)
- `500`: `{"error": "internal server error"}`

トークンは参加者用の `password_reset_tokens` ではなく `staff_password_reset_tokens` に入ります(`participant_id` が not null の FK なので相乗りできません)。検証・パスワード更新・残りリンクの焼き捨ては DB 関数 `reset_staff_password()` が 1 トランザクションで行い、参加者側と同じくスタッフ行を先にロックしてからトークン行を読み直します(`supabase/migrations/0015_staff_accounts_scope_and_password_reset.sql`)。

パスワードの更新と同じ UPDATE 文で `staff_accounts.sessions_valid_from` も進めるため(`0020_staff_accounts_sessions_valid_from.sql` が `reset_staff_password()` を再定義)、**再設定前に発行されたそのアカウントのセッションはすべて 401 になります**。参加者側の `password_changed_at` と同じ役割です。フロントエンドの設定画面(`/staff/password-reset`)は、そのブラウザのスタッフ Cookie を**消しません**。リンクは別のアカウントでログイン中のブラウザで開かれることもあり、その Cookie が再設定したアカウントのものとは限らないためです。再設定したアカウントの Cookie だった場合は、次に API に 401 で拒否されたときに消えます。

### `POST /api/auth/participant/login`

参加者のログイン。成功時に `participant_session` Cookie を発行します。

- リクエスト: `ParticipantLoginInputSchema` — `{email, password}`
- `200`: `{"ok": true}`
- `401` / `429` / `500`: スタッフ側と同じ(ダミーハッシュによる時間平準化、ログイン成功時の再ハッシュも同様)。`password` の上限 1024 文字もスタッフ側と同じです

**確認済みでないアカウント**(`participants.email_verified_at` が null。エントリーを確認メールのリンクで確定したことがない)は、パスワードが合っていても資格情報の誤りと同じ `401 {"error": "invalid credentials"}` で断ります(#189)。そのパスワードは、確定されていない最後のエントリーの送信者が決めたもので、アドレスの持ち主のものとは限らないためです。未登録のアドレスと同じくダミーハッシュで照合するので、応答も時間も「パスワード違い」「未登録」と区別できません。発行済みのセッションも、`requireParticipant()` が未確認のアカウントのものは 401 で拒否します(`0034` 適用前に発行されたセッションのため)。

発行する JWT には `sub` / `exp` に加えて `pwdChangedAt`(このログインで照合したパスワードの `password_changed_at`)を載せます。追加のクエリは不要で、パスワードハッシュと同じ SELECT で取得しています。

### `POST /api/auth/participant/password-reset/request`

参加者のパスワード再設定リンクの送信要求。`lib/password-reset.ts` の `requestPasswordReset()` が、該当する参加者がいれば使い捨てトークン(有効期限 1 時間)を `password_reset_tokens` に発行し、`FRONTEND_URL/password-reset?token=...` へのリンクをメールで送ります。トークンは Task 3-4 のメール確認トークンと同じく SHA-256 ハッシュのみを保存し、生のトークンは受信者のメールボックスにしか存在しません。

- リクエスト: `PasswordResetRequestInputSchema` — `{email: string(email)}`、および `cf-turnstile-response` ヘッダ
- `200`: `{"ok": true}`
- `400`: メール形式が不正(zValidator)、または `{"error": "turnstile verification failed"}`
- `429`: `{"error": "too many requests"}`(`Retry-After: 60`)

メールアドレスが未登録の場合、トークンの保存に失敗した場合、メール送信に失敗した場合のいずれも、送信できた場合と同じ `200 {"ok": true}` を返します。内部的な失敗は `console.error` に記録されます。

レスポンスが同じでも、**かかる時間が同じでなければ**メールアドレスの列挙に使えてしまいます(未登録なら SELECT 1 回、登録済みならハッシュ化・INSERT・Resend への往復が加わり、通常 100〜500ms 差が出ます)。そのためルートは `requestPasswordReset()` を `await` せず `c.executionCtx.waitUntil()` に渡し、**上記の処理を一切始めないうちに** 200 を返します。この関数は結果を呼び出し元に返さないので、待つ必要もありません。

発行時には、その参加者の**期限切れトークンを削除**します。`/request` は未認証で 1 回ごとに 1 行増えるため、これがないと `password_reset_tokens` が無制限に育ちます。歯止めとして、この 2 本目の防御に加えて 1 章のレート制限(3 回 / 60 秒)と Turnstile が前段に入っています。

### `POST /api/auth/participant/password-reset/confirm`

トークンと新しいパスワードを受け取り、パスワードを再設定します。

- リクエスト: `PasswordResetConfirmInputSchema` — `{token: string(min 1), newPassword: PasswordSchema}`(エントリー時のパスワードと同じポリシー。スタッフ側の説明を参照)
- `200`: `{"ok": true}`
- `400`: `{"error": "invalid or expired token"}`(未知・使用済み・期限切れのトークン)
- `500`: `{"error": "internal server error"}`

未認証で叩けるエンドポイントなので、スタッフ/参加者ログインと同様に Supabase のメッセージはレスポンスに含めず `console.error` に記録するだけにしています。

トークンの検証・パスワード更新・残りトークンの焼き捨ては、DB 関数 `reset_participant_password()` が 1 トランザクションで行います(`supabase/migrations/0011_participants_password_changed_at.sql`)。まず**参加者行を `for update` でロック**し、そのロックの下でトークン行を読み直して使用済み・期限切れを判定するため、同じ参加者宛ての同時リクエストは直列化され、2 番目は `used_at` 済みとして 400 になります。詳細は [`database-schema.md`](./database-schema.md#reset_participant_passwordp_token_hash-p_password_hash) を参照してください。

再設定に成功すると、その参加者に対して残っている他の未使用トークンもまとめて使用済みにします。同じトランザクションなので、焼き捨てに失敗すればパスワード更新ごとロールバックされます。

再設定は**アカウントを確認済みにしません**(#189)。再設定はアドレスの持ち主であることは示しますが地域を変えないので、未確認のアカウントの地域は先回りした送信者が選んだもののままであり、ここで確認済みにすると、その地域にアカウントを固定してしまうためです。未確認のアカウントは再設定してもログインできず、エントリーし直して確認メールのリンクを踏むと確認済みになります(エントリーし直すときにパスワードは問われません)。

同じ UPDATE 文で `participants.password_changed_at` も打刻され、**その参加者の既存セッションがすべて無効になります**。参加者セッションは 7 日有効なステートレス JWT なので、これがないと Cookie を盗まれた参加者がパスワードを変えても攻撃者のアクセスは最大 7 日間続きます。

## 5. 地域管理(統括スタッフ)

`routes/regions.ts`。`id` / `slug` / `name` は列名と API のフィールド名が一致しますが、`allowsDualEntry` ↔ `allows_dual_entry` だけは変換が要るので、`rowToRegion()` / `toRegionRow()` が担当します。地域を作らないと大会も作れないので、統括スタッフが自力で新地域を立ち上げられるようにするためのエンドポイント群です。大会作成画面が `regionId` を選ぶための一覧もここで返します。

**削除は提供しません。** `tournaments` / `participants` / `staff_accounts` から参照されており、地域を消す運用は想定していません。

アプリ全体が統括スタッフ限定なので、`routes/tournaments.ts` と違いガードは `.use('*', requireGeneralStaff())` の1か所です(あちらは公開ルートと同じ `/tournaments` にマウントされているため、ルートごとに付けています)。

### `GET /api/regions`

全地域を `name` 昇順で返します。

- `200`: `Region[]` — `{id, slug, name, allowsDualEntry}`
- `401` / `403`
- `500`: `{"error": "internal server error"}`

読み出しでは行を `RegionSchema` で parse し直していません。slug の文字種ルール(下記)は**作成時の入力規則**であってカラム制約ではないので、この API が無かった頃に Supabase から直接入れた行が引っかかると、実際には問題なく使えている地域の一覧が 500 になってしまいます。

### `POST /api/regions`

- リクエスト: `RegionCreateInputSchema` — `{slug, name, allowsDualEntry?}`
  - `slug` は `/^[a-z][a-z0-9-]{1,30}$/`(先頭の英字を含めて 2〜31 文字)。エントリーフォーム URL(`/{regionSlug}/{tournamentSlug}/entry`)の1セグメントとしてそのまま使うため、パスやクエリで意味を持つ文字と大文字を弾きます。先頭を英字に固定しているのは UUID や数値 id と見分けるためです
  - `name` は 1〜100 文字
  - `allowsDualEntry` は省略可で、既定は `false`(最強位・新人王のどちらか一方のみ)。省略時に許可側へ倒さないのは、この設定を意識しなかった地域が黙って重複エントリーを受け付けてしまわないようにするためです
- `201`: 作成された `Region`
- `400`: バリデーション違反(`zValidator`)
- `409`: `{"error": "slug already in use"}` — slug の重複(Postgres の `23505`)。スタッフが直せる入力ミスなので 500 ではなくこれを返します
- `401` / `403`
- `500`: `{"error": "internal server error"}`

重複 slug 以外の挿入失敗は 400 ではなく 500 です。body は検証済み、`name` はただの `text` 列、`regions` に外部キーもないので、ここに残るのは Supabase に届かない・キーが弾かれたといったサーバ側の失敗だけで、生の Supabase メッセージを 400 で返すと管理画面がインフラ障害をフォームの入力エラーとして表示してしまいます。

### `PATCH /api/regions/:id`

- パス: `id` は UUID
- リクエスト: `RegionUpdateInputSchema` — `{name?, allowsDualEntry?}`(両方省略した空の body は 400)
- `200`: 更新後の `Region`
- `400`: バリデーション違反(`zValidator`)
- `404`: `{"error": "region not found"}`(Supabase の `PGRST116` を変換)
- `401` / `403`
- `500`: `{"error": "internal server error"}` — 作成時と同じ理由で、対象が無い以外の更新失敗はサーバ側の失敗として扱います

**`slug` は更新できません。** 公開済みのエントリーフォーム URL の一部なので、後から変えると配布済みのリンクが壊れます。`RegionUpdateInputSchema` は `name` と `allowsDualEntry` だけを `pick` しているため、body に `slug` を入れても(他に更新するフィールドがあれば)400 にはならず、単に無視されます。

`name` / `allowsDualEntry` はどちらも PATCH なので**任意**です。省略したフィールドは `toRegionRow()` が UPDATE 文から落とすので、地域名だけを直したいときに重複参加の設定が巻き添えで変わることも、設定だけを切り替えたいときに(取得後に他のスタッフが改名した)古い `name` を書き戻してしまうこともありません。両方を省略した body は更新する対象が無く、クライアント側のバグでしかないので 400 で弾きます。

## 6. 大会管理(統括スタッフ)

`routes/tournaments.ts`。camelCase の API 形状と snake_case のカラム名の相互変換はこのファイル内の `rowToTournament()` / `toTournamentRow()` が担当します。

### `GET /api/tournaments`

全大会を、統括スタッフが決めた表示順(`tournaments.display_order`、`PUT /api/tournaments/order`)で返します。

- `200`: `Tournament[]`
- `500`: `{"error": <Supabase のメッセージ>}`

### `GET /api/tournaments/:id`

大会を1件返します。大会編集画面用(以前は全件を取ってきてクライアント側で `find` していました、#123)。編集画面に必要なフォーム定義も同じクエリで埋め込んで返します。`GET /api/form-definitions/:tournamentId` を別に呼ぶと、そちらの受付期間ゲートが大会をもう一度読むためです。

- パス: `id` は UUID
- `200`: `{tournament: Tournament, customName: string | null, formFieldDefs: FormFieldDef[]}`
  - `customName` はスタッフが入力した大会名で、空欄にしていれば `null`。`tournament.name` には既定名が入るので、編集フォームはこちらを初期値にして空欄を空欄のまま表示します
  - `formFieldDefs` は `display_order` 順
- `400`: `id` が UUID でない
- `404`: `{"error": "tournament not found"}`
- `500`: `{"error": "internal server error"}`

1セグメントのパスなので、2セグメントの `GET /api/tournaments/:regionSlug/:tournamentSlug` や `/:tournamentId/...` 系のルートとは衝突しません。

### `POST /api/tournaments`

- リクエスト: `TournamentCreateInputSchema` — `{regionId, type, name, capacity, entryOpensAt, entryClosesAt}`
  - `name` は**任意**(#164)。省略・空文字・空白のみのときは `null` を保存し、応答では地域名と種別のラベルをつないだ `defaultTournamentName()`(`packages/shared`、例: `東京最強位`)を返します。既定名は**読むたびに**その時点の地域名・種別から作る(`lib/tournaments.ts` の `tournamentDisplayName()`、`0024`)ので、地域名を変えたり大会の地域・種別を直したりすると大会名も追従します。
  - `capacity` は `null` 可(定員無制限)。
  - `entryOpensAt` / `entryClosesAt` はオフセット付き ISO 8601 文字列。
- `201`: 作成された `Tournament`
- `400`: `{"error": ...}` — Zod のバリデーションエラー、または DB が拒否した既知の制約違反(下記)
- `500`: `{"error": "internal server error"}` — それ以外の DB エラー

DB の制約違反は、Postgres のメッセージ(テーブル名・列名・制約名を含む)をそのまま返さず、**既知のものだけを日本語に置き換えて** 400 で返します(#122)。管理画面はこの文言をフォームの上にそのまま表示します。

| SQLSTATE | `error` | 条件 |
| --- | --- | --- |
| `23505` | `この地域には同じ種別の大会がすでにあります` | `unique (region_id, type)` 違反 |
| `23503` | `指定された地域が存在しません` | `regionId` の地域が存在しない |

それ以外は `internalError()` でログに送り、定型文の 500 にします。

### `PATCH /api/tournaments/:id`

- パス: `id` は UUID
- リクエスト: 上記の全フィールドを部分適用(`.partial()`)
  - `name` を省略すると現在の大会名のまま。**空文字(空白のみ)を送ると大会名を `null` に戻し**、以後は既定の大会名(その時点の地域・種別から作る)で表示します
- `200`: 更新後の `Tournament`
- `capacity` を送った場合は、更新後にキャンセル待ちの繰り上げ(`promote_waitlisted_entries()`、`0037`)を行い、繰り上げた参加者に通知メールを送ります(#223)。定員を増やした・空欄(定員なし)にしたとき、または以前の繰り上げの失敗で空席が残っていたときに、空いた席の数だけキャンセル待ちの先頭から確定にします。空きが無ければ何もしません(定員を減らしても確定済みはそのまま)
- `200` の本文は `TournamentUpdateResponse` — 更新後の `Tournament` に `promotion` を加えたもの。`promotion` は `{promotedCount, mailFailedCount}`(繰り上げた件数と、通知メールを送れなかった件数。`capacity` を送らなかった場合は両方 `0`)、繰り上げ自体に失敗した場合は `null`。更新はコミット済みなので失敗でも `200` を返し、ログに残します(定員を保存し直すと再実行されます)。大会編集画面はこれを「キャンセル待ち N 件を繰り上げ、通知メールを送りました」などと表示します
- `404`: 対象が存在しない(Supabase の `PGRST116` を 404 に変換)
- `400`: Zod のバリデーションエラー、または上の `POST` と同じ既知の制約違反(日本語の `error`)
- `500`: それ以外の更新失敗(`{"error": "internal server error"}`)

### `DELETE /api/tournaments/:id`

間違えて作成した大会を削除します(#164)。大会の `regulations`・`form_field_defs`・`mail_jobs` も一緒に消えます(`0023` で `on delete cascade`)。`entries` は cascade にしていないので、**エントリーが 1 件でもある大会(キャンセル済みのみでも)は削除できません**。エントリーは参加者の個人情報であり参加の記録でもあるため、大会の削除に巻き込まないためです。

- パス: `id` は UUID
- `204`: 削除した
- `404`: `{"error": "tournament not found"}`
- `409`: `{"error": "エントリーがある大会は削除できません"}` — `entries` の外部キー違反(`23503`)
- `500`: `{"error": "internal server error"}`

本文の無い DELETE なので CSRF の origin 検査(§1)の対象になります。管理画面からは大会編集画面の form action(`?/delete`)がサーバ側から呼ぶため、`Origin` は SvelteKit が付けます。

### `POST /api/tournaments/:id/reset`

大会の参加者データをリセットします。その大会のエントリーを**キャンセル済みも含めて全件**削除し、`deleteParticipants` が `true` なら、それらの参加者アカウントも削除します。大会・レギュレーション・フォーム定義・一斉メールの記録は残ります。処理は `reset_tournament_entries()`(`0038`、`docs/database-schema.md` 5 章)が 1 トランザクションで行います。

**統括スタッフ専用**です。地域スタッフは担当大会のエントリーを閲覧・一斉メール送信できますが、取り消せない一括削除を誤って実行する事故を避けるため、この操作は持たせていません。同じ理由で、**エントリー期間中(`entry_opens_at` ≦ 現在 ≦ `entry_closes_at`)の大会は何も消さずに 409 で断ります**(編集画面を開き間違えて受付中の大会を消さないため)。

一斉メールの送信中にリセットしても、キューに積まれた送信待ちのメールは止まりません(宛先はメッセージに入っているため、削除した参加者にも届きます)。画面ではその旨の注意書きを出しています。

参加者アカウントを削除する場合も、**他の大会にエントリーが残っている参加者のアカウントは残します**(重複エントリーを認める地域で、もう一方の大会を壊さないため)。削除されたアカウントの参加者セッションは、次のリクエストで `requireParticipant()` が 401 にします。

- パス: `id` は UUID
- リクエスト: `TournamentResetInput` — `{"deleteParticipants": boolean}`(省略不可。アカウントをどうするかを必ず選ばせるため)
- `200`: `TournamentResetResponse` — `{"deletedEntryCount": number, "deletedParticipantCount": number, "keptParticipantCount": number}`。`keptParticipantCount` は他の大会にエントリーが残っているため残したアカウント数(`deleteParticipants: false` なら常に 0)
- `400`: Zod のバリデーションエラー
- `404`: `{"error": "tournament not found"}`
- `409`: `{"error": "エントリー期間中の大会はリセットできません"}` — SQLSTATE `P0007`
- `500`: `{"error": "internal server error"}`

管理画面からは大会編集画面の form action(`?/reset`)が呼びます。画面では「参加者アカウントは残す / 削除する」のどちらも既定で選ばれておらず、確認のため「リセット」と入力しないと送信できません(form action が NFKC 正規化と前後の空白除去をしてから比べるので、半角の「ﾘｾｯﾄ」や IME が残す全角スペースも通ります)。エントリー期間中の大会では、画面を表示した時点の判定でボタンを無効にします。

### `PUT /api/tournaments/order`

大会の表示順を決めます。全大会の id を表示したい順に並べて送り、`reorder_tournaments()`(0032)がその順に `display_order` を 0 から振り直します。エントリーポータル(`GET /api/portal/tournaments`)・全地域ダッシュボード(`GET /api/staff/dashboard`)・`GET /api/tournaments` はこの順で返します。新しく作った大会(作成・一括登録とも)は末尾に付きます。

1 件ずつの移動ではなく**全体の順番を送る**形にしているのは、画面に表示していた順がそのまま保存されるようにするためです。送った id が今ある大会とちょうど一致しない(並べ替え画面を開いた後に大会が作成・削除された)ときは何も書かずに 409 で断ります。

- リクエスト: `TournamentOrderInput` — `{"tournamentIds": string[]}`(UUID、1 件以上、重複なし)
- `204`: 保存した
- `400`: Zod のバリデーションエラー
- `409`: `{"error": "並べ替えの間に大会が追加または削除されました。ページを読み込み直してから、もう一度並べ替えてください"}` — SQLSTATE `P0003`
- `500`: `{"error": "internal server error"}`

### `GET /api/tournaments/:regionSlug/:tournamentSlug`

エントリー期間中は公開、期間外は担当スタッフのみ(`requireOpenEntryPeriodOrStaff()`、§1「認可ミドルウェア」)。地域スラッグと大会種別スラッグの組から大会を1件引きます。`tournaments` に列を返さない空の埋め込み `regions!inner()` を付け、`regions.slug` と `type` で絞る**1回のクエリ**です(#123。以前は `regions` → `tournaments` の2段階でした)。内部結合なので地域が無い場合も「該当行なし」になります。クエリはミドルウェアが行い、ハンドラはその結果を返すだけです。

- パス: `tournamentSlug` は `'saikyoi' | 'shinjinou'`
- `200`: `Tournament`
- `401`: `{"error": "staff session expired"}` — `staff_session` はあるが検証できない(期限切れ等)
- `403`: `{"error": "entry period closed"}` — 期間外で、担当スタッフのセッションが無い
- `404`: `{"error": "tournament not found"}`(地域が無い場合も同じ応答)
- `500`

公開エントリーリスト画面はこの API を使いません。期間終了後こそ読まれる画面なので、スラッグ引きの `GET /api/tournaments/:regionSlug/:tournamentSlug/entry-list`(§8)から直接引きます。

### `GET /api/tournaments/:tournamentId/regulations`

エントリー期間中は公開、期間外は担当スタッフのみ(`requireOpenEntryPeriodOrStaff()`)。大会に紐づくレギュレーションを `display_order` 昇順で返します。期間中に認証を課さないのは、エントリーフォームが未ログインの訪問者にも選択肢を出す必要があり、レギュレーションが個人情報を含まない(ラベルと優先期間だけ)ためです。期間外はこれ自体が未公開フォームの中身なので、大会取得 API と同じゲートが掛かります。

- `200`: `Regulation[]` — `{id, tournamentId, label, priorityStartsAt, priorityEndsAt, displayOrder}`
- `400`: `:tournamentId` が UUID でない
- `401`: `{"error": "staff session expired"}` — `staff_session` はあるが検証できない(期限切れ等)
- `403`: `{"error": "entry period closed"}` — 期間外で、担当スタッフのセッションが無い
- `404`: `{"error": "tournament not found"}` — ゲートが大会を引けなかった
- `500`

`src/index.ts` では**`tournamentsRoute` より前**にマウントしています。`tournamentsRoute` の `/:regionSlug/:tournamentSlug` も2セグメントにマッチするため、後ろに置くとその `tournamentSlug` の enum バリデーションが先に 400 を返してしまいます(`entryListRoute` と同じ理由)。

### `PUT /api/tournaments/:tournamentId/regulations`

統括スタッフ限定。大会のレギュレーションを**まとめて保存**します。`PUT /api/form-definitions/:tournamentId` と同じく「保存後にこうなっていてほしい状態」を丸ごと送るモデルで、個別の POST/PATCH/DELETE はありません。処理の本体は `apps/backend/src/lib/regulations.ts` の `syncRegulations()`、実際の差分適用は Postgres 関数 `sync_regulations()`(`supabase/migrations/0014_sync_regulations_fn.sql`)です。

- リクエスト: `RegulationSyncInputSchema` — `{regulations: RegulationUpsert[]}`
  | フィールド | 型 | 備考 |
  | --- | --- | --- |
  | `id` | string(uuid) | 省略可。**指定すると既存行の更新、省略すると新規追加** |
  | `label` | string | 1〜300文字(`REGULATION_LABEL_MAX_LENGTH`) |
  | `priorityStartsAt` | string(datetime) \| null | 省略時は `null` |
  | `priorityEndsAt` | string(datetime) \| null | 省略時は `null` |
- `displayOrder` は送りません。**配列の並び順がそのまま `display_order`** になるので、並べ替えは配列を並べ替えるだけです。
- 優先期間は「両方 null」か「両方指定(開始 < 終了)」のみ許容します(Zod と `regulations` の check 制約 `regulations_priority_window_complete` の両方で担保)。
- 配列に含まれなかった既存行は削除されますが、**エントリーから参照されている行は削除できません**。`entry_regulations` が複合外部キー `(regulation_id, tournament_id)` で参照しているため、フォーム定義のような delete → insert は使えず、id 指定は update・id 無しは insert・消えた行は「参照が無ければ delete」という差分同期になっています。
- `regulations` は1件以上必要です(エントリーは必ず1つ以上選ぶため、0件の大会はエントリー不可になる)。

- `200`: `{"ok": true}`
- `400`: `:tournamentId` が UUID でない / リクエストが `RegulationSyncInputSchema` に合わない / `id` がこの大会のレギュレーションでない(`この大会に存在しないレギュレーションが指定されています: ...`)
- `401`: スタッフセッションが無い
- `403`: 地域スタッフ
- `404`: `{"error": "tournament not found"}`
- `409`: `{"error": "エントリーで使用中のため削除できないレギュレーションがあります: ..."}` — 何も書き込まれていないので、該当レギュレーションを戻して送り直せます(保存中のエントリー作成は大会行のロックで直列化されるので、「検査は通ったのに削除で FK 違反」という中間状態にはなりません)
- `500`

## 7. エントリー(参加者向け)

### `POST /api/tournaments/:tournamentId/entries`

未ログインでのエントリー登録。処理の本体は `apps/backend/src/lib/entries.ts` の `checkEntrySubmission()` と `createEntryUnauthenticated()` です。

**応答はメールアドレスの状態によらず同じです**(#117)。「登録済みのアドレスか」「どの地域で登録済みか」が応答から読めると、この API がアドレスの登録有無を調べる手段になってしまうためです(ログインとパスワード再設定要求は既に同じ対策をしています)。そこで:

- アドレスに依存しない検証(大会・エントリー期間・優先期間・追加項目)だけをその場で行い、失敗ならエラーを返す
- 通ったら **`202 {"ok": true}` を先に返し**、残り(参加者の検索・作成、パスワード照合、エントリー作成、メール送信)は `waitUntil()` で応答の後に行う。分岐ごとの処理時間(PBKDF2 の有無、メール送信の有無)が応答時間に出ないようにするため
- 既存アカウントに関わる理由で登録できなかった場合は、エラーを返す代わりに**そのアドレスへ理由をメールで送る**(件名「エントリーを受け付けられませんでした」。`lib/entry-notice.ts`)。エントリーは作らない

「確認済み」は、そのアカウントのエントリーを確認メールのリンクで確定したことがある(`participants.email_verified_at` が null でない)ことを指します(#189)。

| アドレスの状態 | 結果 | 送るメール |
| --- | --- | --- |
| 未登録 | アカウントとエントリーを作成 | 確認メール |
| 確認済み + パスワード一致 | エントリーを作成 | 確認メール |
| 確認済み + パスワード不一致 | 作らない | 「登録済みのパスワードでログインしてからエントリーしてください」 |
| 確認済み + 別地域で登録済み | 作らない | 「別の地域で登録済み」 |
| 未確認 + パスワード一致 + 同じ地域 | エントリーを作成(先のエントリーも残す) | 確認メール |
| 未確認 + それ以外(パスワード不一致、または別の地域) | アカウントのパスワードと地域をこの送信のもので上書きし、先の送信が作ったエントリーと確認トークンを削除してから、エントリーを作成 | 確認メール |
| 未登録 / 未確認の上書き + よく使われるパスワード | 作らない | 「よく使われているパスワードのため登録できませんでした」 |
| 同じ大会にエントリー済み | 作らない | 「既にエントリー済み」 |
| 同一地域の別大会にエントリー済み(重複不可の地域) | 作らない | 「どちらか一方にのみエントリーできます」 |
| フォームを開いている間にレギュレーションが削除された | 作らない | 「レギュレーションが変更された」 |
| サーバー側の失敗 | 作らない(ロールバック) | 「時間をおいてもう一度エントリーしてください」(メール送信自体が失敗した場合は届かず、ログのみ) |

未確認のアカウントを上書きするのは、他人のアドレスで遠方の地域に先回りして登録し、持ち主を自分の地域から締め出したり、自分で決めたパスワードでそのアカウントにログインしたりできたためです(#189)。未確認のアカウントは誰のものとも確かめられていないので、そのパスワードと地域には重みを置かず、後から来た送信がアカウントを作り直します。先のエントリーを消すのは、その確認リンク(アドレスの持ち主に届いている)を踏むと、上書き後のパスワードと地域、つまりリンクを発行したのとは別の送信のもので確認済みになってしまうためです。上書きと行き違いに書かれたエントリーも、確認メールを送る前に取り下げます(`isStillUnverifiedAccountOf()`)。DB 側の処理は [`database-schema.md`](./database-schema.md#take_over_unverified_participantp_participant_id-p_password_hash-p_region_id) を参照してください。

アドレスの持ち主でない人が後から送信すると、持ち主の確定前のエントリーが消えます(持ち主にはその人のエントリーの確認メールが届くだけで、確定はされません)。持ち主がもう一度エントリーすれば取り戻せ、確認リンクを踏んで確認済みになった後は上書きされません。

既にアカウントを持つ参加者には、フォームからログイン画面(`/mypage/login?redirectTo=<フォームのパス>`)へ誘導し、ログイン後は下の `POST .../entries/session` でエントリーさせます。

- リクエスト: `EntryInputSchema`

  | フィールド | 型 | 備考 |
  | --- | --- | --- |
  | `name` | string(1〜100 文字) | 氏名 |
  | `furigana` | string(1〜100 文字) | ふりがな |
  | `displayName` | string(1〜100 文字) | 公開リスト掲載名 |
  | `email` | string(email) | アカウントのメールアドレス |
  | `password` | `PasswordLengthSchema`(8〜256 文字) | `packages/shared/src/schemas/password.ts` |
  | `passwordConfirm` | `PasswordLengthSchema` | `password` と一致必須 |

  `password` には**長さの制限しかかけません**。この欄は新規の参加者がパスワードを決める欄であると同時に、登録済みの参加者が既存のパスワードを示す欄でもあり、ポリシー導入前によく使われるパスワードを設定した参加者を締め出さないためです。よく使われるパスワードの拒否(`PasswordSchema`)は、アドレスが未登録だと分かった時点でバックエンドが行い、ほかのアドレス依存の理由と同じくメールで伝えます。
  | `regulationIds` | string(uuid)[] (min 1) | 選択したレギュレーション。複数該当し得るので配列(issue #112) |
  | `freeText` | string(任意、2000 文字以内) | |
  | `customFieldValues` | `Record<string, string \| string[]>` | 追加フォーム項目の回答。回答 1 件(`checkbox` は各要素)2000 文字以内、全回答の合計 10000 文字以内 |

  長さの上限(#122)は `packages/shared/src/schemas/entry.ts` の定数(`ENTRY_NAME_MAX_LENGTH` / `ENTRY_FREE_TEXT_MAX_LENGTH`)と `packages/shared/src/logic/custom-field-values.ts` の定数(`CUSTOM_FIELD_VALUE_MAX_LENGTH` / `CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH`)にあり、`POST .../entries/session` と `PATCH /api/mypage/entries/:entryId` も同じスキーマで同じ上限を掛けます。上限が無いと 1 リクエストで数 MB を保存でき、公開エントリーリスト・スタッフ一覧・CSV にそのまま乗るためです。DB にも同じ値の check 制約があります(`database-schema.md` の `entries`)。超過は Zod のバリデーションエラー(400)です。

  氏名・ふりがな・掲載名は前後の空白(全角スペースを含む)を除いてから検証し、空白だけの値は未入力として、制御文字・書式文字(Unicode の `Cc` / `Cf`。改行、ゼロ幅文字、U+202E などの双方向制御文字)を含む値は 400 で断ります(#193)。掲載名は認証不要の公開エントリーリストにそのまま載るため、表示を反転・偽装できる文字を通さないためです。メールアドレスは全エンドポイント共通で 254 文字までです(`EMAIL_MAX_LENGTH`、`packages/shared/src/schemas/email.ts`)。

  加えて **`cf-turnstile-response` ヘッダ**(Turnstile のトークン)が必須です。1 章「レート制限と Turnstile」を参照してください。

- `202`: `{"ok": true}`(アドレスの状態によらず同じ。上記参照)

エラー(いずれもアドレスに依存しないもの):

| ステータス | `error` | 条件 |
| --- | --- | --- |
| 400 | `turnstile verification failed` | Turnstile のトークンが無い / 無効 / 検証できなかった |
| 429 | `too many requests` | レート制限超過(`Retry-After: 60`) |
| 400 | `invalid tournament` | `:tournamentId` の大会が存在しない |
| 400 | `unknown custom field: ...` 等 | `customFieldValues` が大会の `form_field_defs` と一致しない(メッセージは [`form-generation.md`](./form-generation.md) の一覧を参照) |
| 403 | `entry period closed` | エントリー期間外 |
| 403 | `regulation not eligible in priority window` | `regulationIds` が空、この大会のものでない id を含む、または優先期間中に優先対象を1つも選んでいない |
| 500 | `internal server error` | 大会や `form_field_defs` の取得に失敗 |

### `POST /api/tournaments/:tournamentId/entries/session`

ログイン中の参加者のエントリー登録(#117)。本体は `createEntryForParticipant()` です。セッションで本人確認が済んでいるので、アドレスとパスワードは送らず、断る理由も**その場でエラーとして返します**(伝える相手は既にそのアカウントの持ち主なので、漏れる情報がありません)。

- 認証: `participant_session` Cookie(`requireParticipant()`)
- リクエスト: `EntrySessionInputSchema`(`EntryInputSchema` から `email` / `password` / `passwordConfirm` を除いたもの)と `cf-turnstile-response` ヘッダ
- `201`: `{"id": "<entry id>"}`。確認メールはアカウントのアドレスへ送る

エラー:

| ステータス | `error` | 条件 |
| --- | --- | --- |
| 401 | `unauthorized` | セッションが無い / 無効 |
| 400 / 403 | (上と同じ) | 大会・期間・優先期間・追加項目の検証 |
| 409 | `already registered in another region` | アカウントが別地域のもの(ログインできるのは確認済みのアカウントだけなので、地域はアドレスの持ち主が確定させたもの) |
| 409 | `already entered` | 同じ大会に確定済み・キャンセル待ちのエントリーが既にある |
| 409 | `entry pending verification` | 同じ大会に確定待ちのエントリーがあり、その確認リンクがまだ有効(#172) |
| 409 | `regulation no longer available` | フォームを開いている間に `PUT .../regulations` が対象のレギュレーションを削除した(エントリー行はロールバックされる) |
| 409 | `already entered another tournament in this region` | `regions.allows_dual_entry` が false の地域で、同一地域の**別の**大会にキャンセル以外のエントリーが既にある |
| 500 | `internal server error` | エントリーの作成や確認メールの送信に失敗 |

処理の流れ:

2 つのエンドポイントに共通する処理の流れ(未ログインの方では 3. 以降が `waitUntil()` の中で動く):

1. 大会とそのレギュレーション群を取得し、エントリー期間・優先期間を検証。
2. その大会の `form_field_defs` を取得し、`customFieldValues` を `findCustomFieldValuesError()` で照合(未定義キー、選択肢にない値、必須項目の空欄、型の不一致を 400 で弾く)。
3. 未ログインならメールアドレスから participant を検索し、既存なら**パスワード照合**、無ければ新規作成(PBKDF2 でハッシュ化)。ログイン中ならセッションの participant を使う。
4. その participant の確定待ちエントリーのうち、**確認リンクの期限が切れたもの**を `cancelled` にする(DB 関数 `lapse_expired_pending_entries()`、#172。後述)。
5. 同じ大会の既存エントリーを確認。`cancelled` なら**その行を再利用**して上書き(`unique (participant_id, tournament_id)` があるため2行目は作れない)、確認リンクが有効な確定待ちなら `entry pending verification`、それ以外なら `already entered` で 409。
6. 地域が重複参加を許していなければ(`regions.allows_dual_entry` が false)、同一地域の**別**大会に有効なエントリーが無いことを確認。
7. 確認メールを送信。

`customFieldValues` の照合を participant の検索・作成より前に置いているのは、フォームからは生成し得ない回答を弾いた結果としてアカウントだけが作られる、という副作用を残さないためです。編集 API(`PATCH /api/mypage/entries/:entryId`)と同じ `findCustomFieldValuesError()` を使うので、新規と編集で通る回答は一致します。

重複参加の判定で数えるのは `pending_verification` / `confirmed` / `waitlisted` で、**`cancelled` は数えません**。キャンセルしたなら他方に出られるべきだからです。逆に `pending_verification` を数えるのは、メール確認前の枠取りで両方を押さえるのを防ぐためです。判定対象から**この大会自身は除いて**いるので、キャンセル後に同じ大会へ再エントリーする経路(上の 5.)はそのまま通ります。

**確認メールの期限切れ(#172)。** 確認リンク(24 時間)を開かないまま期限が切れたエントリーは、もう確定できないのに `pending_verification` のまま残り、同じ大会への再エントリーを `already entered` で、重複参加を許さない地域ではもう一方の大会へのエントリーも断っていました。そこで 4. で、その参加者の確定待ちエントリーのうち**確認トークンが 1 つ以上あり、そのどれもが使用済みか期限切れのもの**を `cancelled` にし(残っていたトークンも使用済みにする)、以後は参加者自身のキャンセルと同じ扱いにしています。同じ大会なら行が再利用されて新しい確認メールが届き、もう一方の大会の枠も空きます。リンクがまだ有効な確定待ちは今までどおり断り、未ログインの経路では不受理通知(`pending-verification`)で「確認メールのリンクを開く / 見当たらなければマイページでキャンセルしてから再エントリー」を案内します。

トークンが 1 つも無い確定待ちは取り消しません。同じ参加者の別の送信が行を書き込み、まだ確認トークンを書いていない途中のエントリーだからです(確認メールの送信に失敗した行はロールバックで消すか元に戻すので、トークン無しのまま残ることはありません)。キャンセル済みの行を再利用するときは、更新の前にその行の**使用済み・期限切れのトークンを消す**ので、再利用中の行もトークン無しの状態を経て新しいトークンが書かれます(同時に同じ行を再利用した別の送信の、有効なトークンは消しません)。

`lapse_expired_pending_entries()`(`supabase/migrations/0030_lapse_expired_pending_entries.sql`)は、候補をロック無しで絞り込んでから(期限内のリンクがある確定待ちにはロックを取らない)、候補ごとに `confirm_entry_by_token()` / `cancel_own_entry()` と同じ順(確認トークン → 大会の行)でロックを取り、状態とトークンを大会のロックの下で読み直します。確認と同時に走っても、確認が先ならもう確定待ちではないので触らず、こちらが先なら確認側は期限切れトークンとして断ります。候補は大会 id 順に処理するので、別々の参加者の呼び出しが大会の行を逆順に取り合ってデッドロックすることもありません。定期的な掃除(Cron)にしていないのは、期限切れの確定待ちが邪魔をするのは同じ参加者の次のエントリーだけだからです。

メール送信に失敗した場合はエントリーを**ロールバック**します。放置すると、参加者は使えるリンクを受け取っていないのに一意制約や「already entered」で再試行を永久に阻まれるためです。ロールバックは「確認トークンの削除 → 新規行なら削除 / 再利用行なら元の値へ復元」の順に行います(トークンが FK で参照している間はエントリーを削除できないため)。再利用行は削除ではなく**キャンセル状態へ復元**することで、元のエントリーの記録が消えないようにしています。

### `POST /api/entries/verify`

フロントエンドの `/verify` ページで「エントリーを確定する」ボタンを押したときに叩かれるエンドポイント。DB 関数 `confirm_entry_by_token()` を呼び、エントリーを確定またはキャンセル待ちに載せます。

- ボディ: `{"token": string}`(`EntryVerificationInputSchema`。非空文字列。生トークン。サーバ側で SHA-256 化して照合)
- `200`: `{"status": "confirmed" | "waitlisted", "tournament": {regionSlug, type} | null}`
- `400`: `{"error": "invalid or expired token"}` — 未知 / 期限切れ(発行から24時間)/ 使用済みトークン、またはエントリーが `pending_verification` でなくなっている場合

定員に空きがあれば `confirmed`、埋まっていれば `waitlisted`(順位付き)になります。

**GET では確定しません(#190)。** Outlook Safe Links などのメールゲートウェイやチャットのリンクプレビューは、受信者がクリックする前にリンクを GET で取得します。GET で確定すると、本人が選んでいないエントリー(第三者が本人のアドレスで申し込んだものを含む)まで確定してしまうため、確定はボタンが送る POST に限っています。メールのリンク(`/verify?token=...`)を開いても、ページの `load` はトークンを `/verify` に限定した httpOnly Cookie(有効期限は確認トークンと同じ 24 時間)に移して `/verify` へリダイレクトし、ボタンを表示するだけです。ボタンの form action が Cookie のトークンでこの API を呼び、結果に応じて `/verify?status=...` へリダイレクトします。API が 400 を返したとき、または確定できたときに Cookie を消します。500 のときはトークンを残し、もう一度押せるようにします。

## 8. 公開エントリーリスト

### `GET /api/tournaments/:tournamentId/entry-list`

認証不要の公開エンドポイント。`created_at, id` 昇順で、**1ページ分**を返します。

- クエリ: `PageQuerySchema` — `limit`(1〜500、既定 100)/ `offset`(0 以上、既定 0)
- `200`: `{items: EntryListItem[], total: number, limit: number, offset: number}` — `EntryListItem` は `{displayName: string, status: 'confirmed' | 'waitlisted' | 'cancelled', waitlistPosition: number | null}`。`total` は条件に合う全件数で、ページ本体と同じクエリ(`count: 'exact'`)で取ります。最終行を越えた `offset` には空の `items` と `total` を返します(PostgREST の 416 を空ページとして扱う)
- `400`: `:tournamentId` が UUID でない、`limit` / `offset` が範囲外
- `500`

全件を返さないのは、リスト画面の `load` の戻り値が SSR された HTML に埋め込まれるためです。全件だと定員の大きい地域ほどページが重くなり、締切直前のアクセス集中時に効いてきます。並び順は `created_at, id` で全順序になっているので、オフセットでもページ境界で行が重複・欠落しません。

エントリー期間のゲート(`requireOpenEntryPeriodOrStaff()`)は**意図的に掛けていません**。エントリーリストは公開された結果であり、最も読まれるのは期間が終わった後だからです。

### `GET /api/tournaments/:regionSlug/:tournamentSlug/entry-list`

上と同じものを、公開 URL と同じスラッグの組で引くルート。リスト画面用です。大会取得 API で UUID を解決してから上を叩く形はもう使えません — 大会取得 API はエントリー期間のゲートの後ろにあり、期間終了後にはスタッフ以外を拒むためです。

- パス: `tournamentSlug` は `'saikyoi' | 'shinjinou'`
- クエリ / `200`: 上と同じ(`{items: EntryListItem[], total, limit, offset}`)
- `404`: `{"error": "tournament not found"}`(地域が無い場合も同じ応答)
- `500`

個人情報保護の観点から、以下の設計になっています。

- 返すのは掲載名・ステータス・キャンセル待ち順位の**3項目のみ**。`name` / `furigana` / `email` / `freeText` / `customFieldValues` は一切含みません(`EntryListItemSchema` がそれを型で保証しています)。
- `pending_verification` のエントリーは除外します(メール確認前の申し込みを公開しないため)。
- `cancelled` の行は削除せず、`displayName` を `"キャンセル"` に**マスクして返します**。行自体を落とさないのは、繰り上げ処理が更新するのは繰り上がった側の行だけで、キャンセルされた行はそのまま残るためです。

### `GET /api/tournaments/:tournamentId/entry-counts`

認証不要の公開エンドポイント。その大会の `confirmed` と `waitlisted` のエントリー数を返します。エントリーフォームが冒頭で「キャンセル待ちが発生している」と案内するためのものです(#186。確定件数が定員に達しているとき。確定処理 `confirm_entry_by_token()` と同じ条件で、キャンセル待ちの件数だけでは判定しない)。

- `200`: `{confirmedCount: number, waitlistedCount: number}`(`TournamentEntryCountsSchema`)
- `400`: `:tournamentId` が UUID でない
- `500`

どちらの数も公開エントリーリストから数えられるので、エントリー期間のゲートは掛けていません。

## 9. フォーム定義管理(統括スタッフ)

詳細な仕組みは [`form-generation.md`](./form-generation.md) を参照してください。

### `GET /api/form-definitions/:tournamentId`

エントリー期間中は公開、期間外は担当スタッフのみ(`requireOpenEntryPeriodOrStaff()`)。その大会の `form_field_defs` を `display_order` 昇順で返します。期間中に認証を課さないのは、エントリーフォームが未ログインの訪問者にも追加項目を描画する必要があり、フォーム定義が個人情報を含まないためです。期間外はこの定義こそが未公開フォームの中身なので、大会取得 API と同じゲートが掛かります。

- `200`: `FormFieldDef[]` — `{fieldKey, label, plainLabel, fieldType, required, options, displayOrder}`(`plainLabel` は `label` 内の `<a>` リンクを文字だけにしたもの。#173)
- `400`: `:tournamentId` が UUID でない
- `401`: `{"error": "staff session expired"}` — `staff_session` はあるが検証できない(期限切れ等)
- `403`: `{"error": "entry period closed"}` — 期間外で、担当スタッフのセッションが無い
- `404`: `{"error": "tournament not found"}` — ゲートが大会を引けなかった
- `500`

この期間中は公開の GET があるため、`formDefinitionsRoute` は `requireGeneralStaff()` を `.use('*', ...)` ではなく**下の PUT にだけ**付けています。

### `PUT /api/form-definitions/:tournamentId`

YAML テキストを受け取り、その大会の `form_field_defs` を丸ごと置き換えます。

- リクエスト: `FormDefinitionUploadSchema` — `{yaml: string}`(**パース前の生テキスト**)
- `200`: `{"ok": true}`
- `400`: `{"error": <YAML パース/検証エラーのメッセージ、または大会種別の不一致メッセージ>}`
- `404`: `{"error": "tournament not found"}`
- `500`: `{"error": "internal server error"}`

YAML の `tournamentSlug`(`saikyoi` / `shinjinou`)が `:tournamentId` の大会の `type` と食い違う場合は 400 を返します。**この判定は `sync_form_field_defs()` を呼ぶ前に行うため、既存のフォーム定義は削除されません。** 詳細は [`form-generation.md`](./form-generation.md#tournamentslug-による取り違え検証) を参照。

500 を返す場合、Supabase の生のエラーメッセージはクライアントに返さずサーバログにのみ出力します。

### `POST /api/sheet-import/preview`

Google スプレッドシートを読み取り、フォーム定義 YAML を生成して返します。**この時点では DB に何も書き込みません。** 保存は上記の `PUT /api/form-definitions/:tournamentId` を別途呼びます。

- リクエスト: `SheetImportRequestSchema` — `{spreadsheetId: string, tournamentSlug: 'saikyoi' | 'shinjinou'}`
- `200`: `{"yaml": "..."}`

エラーは失敗の原因によって切り分けています。

| ステータス | 条件 |
| --- | --- |
| 400 | スプレッドシート ID が不正・シートにアクセスできない(Google からの 4xx)、行データが `FormFieldDefYamlSchema` に合わない、`type` 列が既定のラベルでない、`options` 列に重複がある |
| 502 | Google への接続失敗(ネットワークエラー)または Google からの 5xx |
| 503 | Google からのレート制限(429) |

詳細は [`google-sheets-integration.md`](./google-sheets-integration.md) を参照。

### `POST /api/sheet-import/regulations/preview`

同じスプレッドシートの「レギュレーション」シート(`REGULATION_SHEET_NAME`)を読み取り、レギュレーションの配列にして返します。**この時点では DB に何も書き込みません。** 保存はレギュレーション管理画面から `PUT /api/tournaments/:tournamentId/regulations` を別途呼びます。大会には依存しないので、リクエストに大会 ID はありません。

- リクエスト: `RegulationSheetImportRequestSchema` — `{spreadsheetId: string}`
- `200`: `{"regulations": [{label, priorityStartsAt, priorityEndsAt}, ...]}` — シートの行順。`id` は付きません(シートは保存済みの行を知らないため。保存済みの行との突き合わせは呼び出し側が行います)。優先期間はシート上の日時を日本時間として読んだ ISO 8601 文字列、未設定なら `null`。

| ステータス | 条件 |
| --- | --- |
| 400 | 「レギュレーション」シートが無い・スプレッドシート ID が不正・シートにアクセスできない(429 を除く Google からの 4xx)、レギュレーション名が空または重複、優先期間を日時として読めない、優先期間が片方だけ・終了が開始以前、レギュレーションが1件も無い |
| 502 | Google への接続失敗(ネットワークエラー)または Google からの 5xx |
| 503 | Google からのレート制限(429) |

行に起因する 400 の `error` は `3行目: ...` の形でシートの行番号を含みます。詳細は [`google-sheets-integration.md`](./google-sheets-integration.md#6-レギュレーションシートのフォーマット規約) を参照。

### `POST /api/sheet-import/tournaments/preview`

大会一覧のスプレッドシートを読み、行ごとに「登録すると何が起きるか」を返します(#168)。**DB には書き込みません**。統括スタッフはこの結果を `/admin/tournaments/import` で確認し、大会ごとに新規作成・上書きするかを選んで、下の `POST /api/sheet-import/tournaments` で登録します。各行の入力シートもここで読み、フォーム定義・レギュレーションの誤りは登録前に分かります。

- リクエスト: `TournamentBulkImportRequestSchema` — `{spreadsheetId: string}`。スプレッドシートの URL(`https://docs.google.com/spreadsheets/d/{id}/edit...`)を渡すと ID を取り出します
- `200`: `TournamentBulkImportPreviewResponseSchema` — `{"rows": TournamentImportPreviewRow[]}`。大会一覧の行ごとに 1 件、シートの行順。**登録できない行がいくつあっても 200** です

| `TournamentImportPreviewRow` のフィールド | 内容 |
| --- | --- |
| `row` | 大会一覧の行番号 |
| `regionName` / `typeLabel` | 地域・種別のセルの値(書かれたまま)。登録時に行を指定するのに使う |
| `action` | `create`(同じ地域・種別の大会が無い)/ `overwrite`(既にある)/ `null`(登録できない) |
| `fingerprint` | 書き込む内容(定員・期間・フォーム定義・レギュレーション)と上書き先の大会の現在値から作った SHA-256。登録時にそのまま送り返す。登録できない行では `null` |
| `error` | `action` が `null` の理由(日本語) |
| `capacity` / `entryOpensAt` / `entryClosesAt` | シートの定員(空欄は `null` = 定員なし)とエントリー期間 |
| `formFieldLabels` / `regulationLabels` | 入力シートの追加項目・レギュレーションのラベル |
| `current` | `overwrite` のとき、登録済みの大会の現在の値(`tournamentId` / `name` / `capacity` / `entryOpensAt` / `entryClosesAt`)。それ以外は `null` |

| ステータス | 条件 |
| --- | --- |
| 400 | 大会一覧のシートが読めない(ID が不正・共有されていない)、1 行目に必要な列(地域・種別・定員・エントリー開始・エントリー終了・スプレッドシートID)が無い |
| 502 / 503 | 大会一覧を読むときの Google の障害 / レート制限 |

行が登録できない理由: 地域名が登録されていない・同名の地域が複数ある、種別が 最強位/新人王 以外、定員が 1 以上の整数でない(空欄は可)、エントリー開始・終了が日時として読めない(`2026/11/04 21:00:00` のように年/月/日 時:分[:秒]。日本時間として読む)、開始が終了より後、終了が既に過ぎている、スプレッドシートIDが空、同じ地域・種別の行が複数ある(どちらも登録しない)、入力シートが読めない・「レギュレーション」シートが無い、フォーム定義・レギュレーションの記入誤り(上の 2 つのプレビューと同じ検証)。

### `POST /api/sheet-import/tournaments`

大会一覧のスプレッドシートから、**選んだ大会を登録します**(#168)。**このエンドポイントは DB に書き込みます**。大会一覧と入力シートはここで読み直します。

- リクエスト: `TournamentBulkImportExecuteRequestSchema` — `{spreadsheetId: string, selections: {regionName, typeLabel, action, fingerprint}[]}`。`selections` はプレビューの行の地域・種別・`action`(`create` / `overwrite`)・`fingerprint`。1 件以上 200 件以下で、同じ地域・種別を 2 回含めない
- `200`: `TournamentBulkImportResponseSchema` — `{"results": TournamentImportResult[]}`。`selections` 1 件につき 1 件、渡した順。**何件失敗しても 200** で、件ごとの結果が答えです

| `TournamentImportResult` のフィールド | 内容 |
| --- | --- |
| `row` | 大会一覧の行番号。大会一覧にその地域・種別の行が無くなっていた場合は `null` |
| `regionName` / `typeLabel` | 地域・種別のセルの値(書かれたまま) |
| `outcome` | `created`(新規登録)/ `updated`(既存の大会を上書き)/ `failed`(登録していない) |
| `tournamentId` / `type` / `capacity` / `entryOpensAt` / `entryClosesAt` | 登録した大会。`failed` では `null` |
| `error` | `failed` の理由(日本語)。それ以外では `null` |
| `promotion` | 上書き後のキャンセル待ちの繰り上げ(#223)。`{promotedCount, mailFailedCount}`(繰り上げた件数と、通知メールを送れなかった件数)。新規作成・`failed` では両方 `0`。大会は登録できたが繰り上げに失敗した場合は `null` |

ステータスはプレビューと同じ(加えて `selections` が空なら 400)。

1 件ぶんの登録(大会・フォーム定義・レギュレーション)は DB 関数 `import_tournament()`(`0036`)が **1 トランザクション**で行い、どこかで失敗すればその大会は何も書かれません。失敗した件は理由を返し、残りは登録を続けます。

- **確認した内容しか書かない**: 読み直したシートと現在の大会から `fingerprint` を作り直し、プレビューのものと違えば(シートが編集された、上書き先の大会が編集・作成・削除された)何も書かずに失敗にします。照合から書き込みまでの間に大会が作成・削除された場合も、`import_tournament()` が選ばれた操作と合わないとして `P0006` で断ります
- **新規作成**: 定員・エントリー期間はシートの値、大会名は空欄(既定名)
- **上書き**: 定員・エントリー開始・エントリー終了・フォーム定義・レギュレーションをシートの内容に置き換えます。大会名はシートに無いので変えません。レギュレーションは名前で既存の行と突き合わせて id を引き継ぐので、名前が同じならエントリーの紐付けは保たれます。エントリーで使用中のレギュレーションがシートから消えている(名前が変わった)場合は失敗になります。定員を減らしても、確定済みのエントリーはそのままです(大会の編集 API と同じ)
- 失敗理由はプレビューと同じ検証によるものに加え、`fingerprint` の不一致・上の `P0006`・使用中のレギュレーション

`スプレッドシートID` の列には URL を書いてもかまいません(ID を取り出します)。

各行の入力シートは、フォーム定義(先頭のシート)とレギュレーションシートを `spreadsheets.get`(グリッドデータ付き)の **1 リクエスト**で読みます(Sheets API の分間クォータを、大会数 × 2 ではなく大会数 + 1 に抑えるため)。フォーム定義は表示されている文字列(`10%` は `10%` のまま)、レギュレーションは書式なしの値(日時はシリアル値)を使うので、大会編集画面・レギュレーション画面からの個別の取り込みと同じ読み方になります。同時に処理するのは 4 行までです。

フォーム定義の誤りは `フォーム定義 3行目: A列(key)「...」は...` のように行番号と列を付けて返します。

**Cloudflare Workers の有料プランが前提です。** 1 行ごとに Google への 1 リクエストと Supabase への 1 回の呼び出しが 1 つの Worker リクエストの中で発生します。無料プランのサブリクエスト上限(1 リクエストあたり 50)では約 24 行で上限に達しますが、このプロジェクトは一斉メールの Cloudflare Queues のために有料プランを前提にしており、その上限には余裕があります。HTTP リクエストの処理時間(ウォールクロック)には上限がありません。

ある行の処理で想定外の例外が起きても、その行の失敗として返し、ほかの行の結果は失いません。大会一覧の書式は [`google-sheets-integration.md`](./google-sheets-integration.md) を参照。

## 10. スタッフ向けエントリー閲覧・一斉メール送信

`routes/staff-entries.ts` と `routes/staff-mail.ts`。`requireStaffForTournament()` / `requireStaffForEntry()` により、地域スタッフは担当大会のエントリーしか見られず、担当外の大会にはメールも送れません。統括スタッフは全大会が対象です。`:tournamentId` の大会が存在しない場合、統括スタッフには `404` `{"error": "tournament not found"}`、地域スタッフには `403` を返します(§1「認可ミドルウェア」)。

### `GET /api/staff/tournaments/:tournamentId/entries`

- クエリ: `StaffEntryListQuerySchema` — `limit` / `offset`(公開エントリーリストと同じ `PageQuerySchema`)に加えて、任意の `status`(`EntryStatus` のいずれか)。指定するとそのステータスのエントリーだけに絞り込み、`total` も絞り込み後の件数になります
- `200`: `{items: Entry[], total: number, limit: number, offset: number}`(`created_at, id` 昇順)

`Entry` は `id` / `tournamentId` / `name` / `furigana` / `displayName` / `email` / `regulationIds` / `regulationLabels` / `freeText` / `customFieldValues` / `status` / `waitlistPosition` を含みます。`email` は `participants` の、`regulationIds` / `regulationLabels` は `entry_regulations` 経由の JOIN 結果で、大会の `display_order` 昇順に揃えて返します(1エントリーが複数のレギュレーションを選べるため配列)。

- `400`: `limit` / `offset` が範囲外、または `status` が未知の値
- `401` / `403` / `500`

### `GET /api/staff/tournaments/:tournamentId/entries.csv`

エントリー一覧の CSV エクスポート。一覧エンドポイントと違いページングも絞り込みもせず、当該大会の**全エントリー**(`created_at, id` 昇順)を CSV で返します(全件を手元に落とすのがこのエクスポートの用途のため。内部では `fetchAllRows()` で 500 件ずつ集めます)。

- `200`: `text/csv; charset=utf-8` / `Content-Disposition: attachment; filename="entries-<tournamentId>.csv"`
- `401` / `403` / `500`

| 項目 | 内容 |
| --- | --- |
| 列 | `氏名` / `ふりがな` / `エントリーリスト掲載名` / `メールアドレス` / `ステータス` / `キャンセル待ち順位` / `エントリー日時` / `レギュレーション` / `自由記述` + 当該大会の追加項目(`form_field_defs` の `label` からリンクを除いた文字(`plainLabel`)を見出しに、`display_order` 昇順)。エントリーフォームで入力された内容(パスワードを除く)・アカウントのメールアドレス・ステータスとキャンセル待ち順位・エントリー日時を含めます(#178)。DB から読む列は一覧エンドポイントと同じ select に `created_at` を足したもの(`ENTRY_CSV_COLUMNS`)なので、エントリーに項目が増えたときは CSV の列(`FIXED_HEADERS`)にも足してください。追加項目の見出しが固定列や他の追加項目と同じになる場合は、`自由記述(note)` のように項目キーを添えて区別します |
| 改行 | CRLF(RFC 4180)。末尾に改行は付けません |
| エンコーディング | UTF-8 + BOM。BOM がないと Excel(Windows)が日本語列を文字化けさせるため |
| ステータス | `ENTRY_STATUS_LABELS`(共有)による日本語表記。スタッフ画面の表示と同じ文言です |
| キャンセル待ち順位 | キャンセル待ちのエントリーだけ順位の数字。それ以外は空セル |
| エントリー日時 | `entries.created_at` を日本時間の `YYYY-MM-DD HH:mm` で(表計算ソフトが日時として読む形。`lib/jst.ts` の `formatJstDateTime()`) |
| メールアドレス | 参加者アカウントのアドレス |
| レギュレーション | エントリーが選択したレギュレーションのラベルを、大会の `display_order` 昇順に `;` で連結して1セルに収めます |
| 追加項目の値 | 複数選択チェックボックスは選択肢を `;` で連結。単独ブールチェックボックスは `はい` / `いいえ`(スタッフ詳細画面と同じ)。回答がない項目は空セル |
| 数式の無害化 | `=` `+` `-` `@` タブ・CR のいずれかで始まるセルは、先頭にアポストロフィ(`'`)を付けて出力します(後述) |

追加項目の列は現在のフォーム定義から組み立てるため、エントリー後に項目名を変えた場合は新しい `label` で出力されます。逆に、フォームから削除された項目の回答は出力されません(見出しのない列を作らないため)。

生成ロジックは `apps/backend/src/lib/entries-csv.ts` の `buildEntriesCsv()`。スタッフ画面のエントリー一覧にはこのエンドポイントへのダウンロードリンクがあります。

#### 数式インジェクション対策と、その割り切り

氏名・掲載名・自由記述の回答は参加者が自由に入力できるため、`=HYPERLINK(...)` のような値をそのまま出力すると、スタッフが表計算ソフトで開いた時点で数式として評価されてしまいます(CSV の引用符は数式の実行を防ぎません)。これを避けるため、`=` `+` `-` `@` タブ・CR のいずれかで始まるセルには先頭にアポストロフィを付けています(OWASP が推奨する標準的な緩和策)。

判定は**先頭 1 文字だけ**で行い、値が実際に数式かどうかは見ません。したがって攻撃ではない正当な値にもアポストロフィが付きます。

| 入力 | 出力 |
| --- | --- |
| `-3`(自由記述の負数) | `'-3` |
| `-太郎`(ハイフンで始まる掲載名) | `'-太郎` |
| `@handle` | `'@handle` |

これは意図した挙動で、次の割り切りの上に成り立っています。

- **この CSV は表計算ソフトで開く前提の出力です。** Excel / Google スプレッドシートはセル先頭のアポストロフィを「以降をテキストとして扱う」マーカーとして解釈するため、表示上は見えません。運営がスプレッドシートで名簿を確認する主用途では実害はありません。
- **機械的な再取り込みには使えません。** `pandas.read_csv()` や `csv` モジュール、Numbers などはアポストロフィをただの文字として読むため、`-3` は `'-3` という文字列になり、数値としてパースできません。出力した CSV を編集して再インポートする機能や、名簿を他システムへ取り込む運用が必要になった場合は、この CSV を流用せず、無害化しない JSON エクスポート(あるいは API の直参照)を別に用意してください。

判定を「数式として評価されうる形か」まで厳密にする案は、表計算ソフトのパーサを再実装することになり、判定漏れがそのままインジェクションになるため採用していません(安全側に倒れている現状より悪化するリスクがあります)。経緯は issue #67 を参照してください。

### `GET /api/staff/entries/:entryId`

1件の詳細。

- `200`: `StaffEntryDetail` = `Entry` + `formFieldDefs: FormFieldDef[]`
- `404`: `{"error": "entry not found"}`
- `401` / `403` / `500`

`formFieldDefs` は当該大会のフォーム項目定義を `display_order` 昇順で返すものです。これがないと、スタッフ画面は `customFieldValues` を `t_shirt_size` のような生のキーでしか表示できません。一覧エンドポイントは追加項目の回答を描画しないため、`formFieldDefs` を返しません。

### `PUT /api/staff/tournaments/:tournamentId/entry-pause`

大会のエントリー受付を一時中断・再開します(`0039`)。**統括スタッフと、その大会を担当する地域スタッフ**が使えます(`requireStaffForTournament()`)。大会の他の設定と違って地域スタッフにも許しているのは、大会を運営する側が、レギュレーションの誤りなどを直す間だけ新規受付を止められるようにするためです(再開すれば元に戻り、何も失われません)。

中断中は次のようになります。

- エントリー期間内でも、新しいエントリー(`POST /api/tournaments/:tournamentId/entries` / `.../entries/session`)を **403** `{"error": "entries paused"}` で断る
- フォームを構成する公開 GET は期間外と同じく担当スタッフにしか開けない(§1 `requireOpenEntryPeriodOrStaff()`)。スタッフには確認用として表示する
- ポータル(`GET /api/portal/tournaments`)は `entriesPaused: true` を返し、画面には「一時中断中」と出る。優先エントリーの案内も出さない
- すでにあるエントリーの編集・キャンセル・確認リンクでの確定は**止めない**(中断は新しい受付を止めるためのもので、申し込み済みの人の確認リンクを期限切れにしないため)
- エントリー期間そのものは変えない。期間外になればいつもどおり「受付終了」「受付開始前」として扱う

- パス: `tournamentId` は UUID
- リクエスト: `TournamentEntryPauseInput` — `{"paused": boolean}`(トグルではなく状態を送るので、二重送信しても意図した状態になる)
- `200`: `Tournament`(`entriesPaused` は更新後の値)
- `400`: Zod のバリデーションエラー(認可の後に検査する)
- `403` / `404`: §1「認可ミドルウェア」のとおり
- `500`: `{"error": "internal server error"}`

画面からはスタッフのエントリー一覧(`/staff/[regionSlug]/[tournamentSlug]/entries`)の form action(`?/pause`)が呼びます。

### `POST /api/staff/tournaments/:tournamentId/mail`

`routes/staff-mail.ts`。担当大会の参加者へ一斉メールを送信します。同じ `requireStaffForTournament()` で保護されているため、地域スタッフは担当外の大会には送信できません。

リクエストボディは `StaffMailInput`(`packages/shared/src/schemas/mail.ts`)です。

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `subject` | ✅ | 件名。1〜200 文字 |
| `body` | ✅ | 本文(HTML)。1〜20000 文字。**許可したタグだけに絞ってから**保存・送信します(後述) |
| `statusFilter` | | `StaffMailStatusFilter`(`confirmed` / `waitlisted` / `cancelled`)。指定するとそのステータスのエントリーだけに絞り込みます。**`pending_verification` は指定できません(400)** |

- `202`: `StaffMailResult` = `{"jobId": string, "accepted": number}`
- `400`: ボディが `StaffMailInputSchema` に合わない、または許可タグに絞った結果 `body` に読める文字が残らなかった(空タグと空白だけになった場合を含む。`{"error": "mail body is empty after sanitizing"}`)
- `401` / `403` / `500`

**`statusFilter` を省略した場合、`confirmed` と `waitlisted` のエントリーだけ**が対象です(`apps/backend/src/lib/entry-recipients.ts` の `DEFAULT_RECIPIENT_STATUSES`)。`cancelled` を外すのは、キャンセルした人に案内を送り続けないためで、送るには `statusFilter: "cancelled"` を明示します。

**メール未確認(`pending_verification`)のエントリーには、一斉メールは一切送れません(#192)。** 誰でも他人のアドレスでエントリーして確定せずに放置できるので、スタッフが書いた本文(会場や集合時刻、リンクなど)が、同意していない第三者に組織の送信ドメインから届いてしまいます。未確認の人への催促は、本文を書けない定型の確認メールの再送(下の `POST .../verification-mail`)で行います。

さらに、**どの `statusFilter` でも、アドレスを確認済みの参加者(`participants.email_verified_at` が null でない)にしか送りません。** `confirmed` / `waitlisted` には確認リンクを経て入るのが今の仕組みですが、ステータスだけで判定すると、スタッフによる変更や取り込みなど確認を経ない経路が将来できたときに #192 が再発するためです。

**`200` ではなく `202` を返し、`accepted` は「送信を受け付けた宛先数」であって「届いた通数」ではありません。** このエンドポイントがするのは宛先の確定・`mail_jobs` 行の作成・**Cloudflare Queues への投入まで**で、送信そのものはキューのコンシューマ(`lib/bulk-mail-queue.ts`、Worker の `queue` ハンドラ)が後から行います(Task 10-4 / #114)。どこまで届いたかは下の `GET .../mail/:jobId` で確認します。

**宛先数の上限はありません。** 以前は `MAX_BACKGROUND_RECIPIENTS`(80 件)を超える送信を `413` で拒否していました。送信が `c.executionCtx.waitUntil()` に載っており、Cloudflare が応答後の処理を生かしておくのは約 30 秒だったためです。コンシューマの実行時間はリクエストの寿命と無関係なので、この上限は撤廃しました。**`413` は返しません。**

**キューへの投入に失敗した場合は `500` を返しますが、その時点で投入済みの宛先には送信されます。** 投入は `sendBatch()` 何回かに分かれるため、途中で失敗しても前半は既にキューに乗っており、取り消す手段はありません。積めなかった宛先はジョブの `failed` に計上するので(そうしないと `sent + failed` が `total` に届かず、いつまでも送信中に見えます)、**`500` を受け取ったら再送する前に `GET .../mail/:jobId` で何人に届いたかを確認してください**。そのまま同じ内容を送り直すと、前半の宛先には 2 通届きます。この `500` のボディは `{"error": "internal server error", "jobId": string}` で、**投入に失敗したときだけ `jobId` が付きます**(ジョブを引く手段が他にないため)。それ以前に失敗する `500`(宛先の取得・`mail_jobs` 行の作成)にはジョブがまだ無いので付きません。

投入は 1 メッセージ = 1 宛先です。再試行の粒度が 1 アドレスで済み、部分的な失敗の扱いが単純になるためで、`sendBatch()` の上限(1 回 100 メッセージ)ごとに分割して投入します。メッセージが運ぶのは `{jobId, to}` だけで、件名と本文は `mail_jobs` 行にしか置きません。Cloudflare のメッセージ上限は 1 通 128 KB・1 バッチ 256 KB で、本文は最大 20000 文字あり得るため、宛先ごとに本文を複製すると数十件でバッチ上限を超えるからです。

送信は宛先ごとに 1 通ずつ行います(受信者同士にアドレスが見えないように)。1 件がプロバイダに拒否されても送信全体は止めず、残りの宛先には送り切ります。同じアドレスは重複排除され、1 通しか届きません。

コンシューマ内の送信は `lib/bulk-mail.ts` の `sendPacedMail()` が担い、メールプロバイダのレート制限に合わせて**同時 5 通・バッチ間 1 秒**でならします。プロバイダから **429(レート制限)が返った送信はリトライします**(既定 3 回、`Retry-After` があればそれに従い、なければジッタ付きの指数バックオフ。1 回の待機は最大 5 秒)。それでも 429 のままなら、そのメッセージは **ack せずキューへ戻します**(30 秒後に再配信)。レート制限はアドレスの良し悪しとは無関係だからです。逆に**アドレス自体を拒否された場合は ack して失敗として記録**します。何度配信しても同じ答えしか返らないためです。キューの再配信は 3 回まで(`wrangler.toml` の `max_retries`)で、最後の配信でも 429 だったメッセージは失敗として計上します(そうしないと `sent + failed` が `total` に届かず、いつまでも送信中に見えます)。なお、この再送は一斉メールだけの挙動です。確認メール・パスワード再設定・繰り上げ通知の単発送信はリクエストの中で待たれるため、応答を数秒止めるよりは失敗させる方を選んでいます。

宛先の取得(`lib/entry-recipients.ts`)は `.range()` で**ページングします**。PostgREST は 1 レスポンスの行数を `db-max-rows` で打ち切るため、単純な SELECT では大きな大会の宛先が黙って途中までしか取れず、「全員に送ったつもりで一部にしか届かない」状態になります。

`body` は `lib/mail-html.ts` の `sanitizeMailHtml()` で**許可リスト方式に無害化してから** `mail_jobs.body_html` に保存し、そのまま送ります(Task 11-7 / #122)。送信元は組織の検証済みドメインなので、地域スタッフのアカウントが 1 つ侵害されるだけで、担当大会の参加者全員へ任意の HTML(フィッシング)を送れてしまうためです。

- 残すタグは `p` / `br` / `strong` / `em` / `ul` / `ol` / `li` / `a` だけで、**属性はすべて落とします**(`style` / `class` / `onclick` なども)。
- 例外は `<a>` の `href` で、`http:` / `https:` / `mailto:` の**絶対 URL** のときだけ残します。文字参照(`jav&#97;script:`)や空白を挟んだ書き方も、URL として解釈してからスキームを見るので通りません。相対 URL や他のスキームは `href` だけを落とし、リンクの文字は残します。
- それ以外のタグはタグだけ除いて中の文字を残します。`script` / `style` / `iframe` / `svg` などは中身ごと除きます。コメントや `<!DOCTYPE>` も除きます。
- タグ以外の文字はエスケープします(既にある文字参照 `&amp;` などはそのまま)。
- 無害化した結果が空(空白のみ)になった場合は 400 を返し、送信しません。

**この変更以前は、スタッフが書いた HTML をそのまま送っていました。** 表やインラインのスタイル、画像などを使った本文は、今後は文字だけが残る形で届きます。改行は HTML の本文としては無視されるので、段落は `<p>`、改行は `<br>` で書いてください。

**Cloudflare Queues は有料プラン限定**です。`wrangler dev` はローカルでキューを模擬するので開発と E2E には課金は要りませんが、キューの無いアカウントへのデプロイは `wrangler.toml` の `[[queues.*]]` で失敗します。作成手順は `docs/supabase-deployment.md` の §6.2.2 を参照してください。

### `POST /api/staff/tournaments/:tournamentId/verification-mail`

`routes/staff-mail.ts`。担当大会のメール未確認(`pending_verification`)のエントリーに、**エントリー時と同じ定型の確認メールを、新しい確認リンク付きで再送**します(#192)。リクエストボディはありません。一斉メールで未確認の人に送れなくした代わりの催促手段で、件名も本文もスタッフは書けません。本文には「心当たりがなければ破棄してください」が入っているので、他人のアドレスで登録されたエントリーに届いても、エントリー時に届いたものと同じ 1 通が増えるだけです。

- `202`: `StaffMailResult` = `{"jobId": string, "accepted": number}`。`accepted` は再送を受け付けたエントリー数
- `404`: `{"error": "tournament not found"}`
- `401` / `403` / `500`(キューへの投入に失敗した場合の扱いは一斉メールと同じで、`jobId` が付きます)

**確認リンクがまだ有効なエントリーには送りません**(`lib/entry-verification.ts` の `fetchResendableEntryIds()`)。有効なリンクの入ったメールは既に手元にあるためです。これにより、ボタンを何度押しても、1 つのエントリーに届く再送はリンクの有効期限(24 時間)あたり 1 通までに抑えられます。リンクが切れたエントリーは、次のエントリー送信で `lapse_expired_pending_entries()` に取り消されるまでは `pending_verification` のまま残っており、新しいリンクで確定できます。

一斉メールと同じキューと `mail_jobs` を使い、進み具合は同じ `GET .../mail/:jobId` で読めます。違いは次のとおりです。

- メッセージが運ぶのは `{jobId, entryId}` で、**アドレスもトークンも運びません**。確認トークンはコンシューマが送信の直前に発行します(`prepareVerificationResend()`)。使えるトークンがキュー(やデッドレターキュー)に残らないようにするためです
- `mail_jobs` 行の件名は確認メールの件名で、`body_html` は空です(本文はメッセージごとにリンクが違うため、コンシューマが組み立てます)
- コンシューマはエントリーを読み直し、**既に確定・キャンセルされたエントリーや、その間に有効なリンクを得たエントリー(ボタンの二度押しなど)には送りません**。これらは「送らなかった」としてジョブの `failed` に数えます(`sent + failed` を `total` に届かせるため)
- 送信に失敗した再送のトークンは削除します。残すと有効なリンクとして数えられ、429 で再配信されたメッセージも、次の再送も、そのエントリーを飛ばしてしまうためです

### `GET /api/staff/tournaments/:tournamentId/mail/:jobId`

一斉メール 1 件の送信状況。`POST .../mail` または `POST .../verification-mail` が返した `jobId` を渡します。同じ `requireStaffForTournament()` で保護されており、**別大会のジョブは `404`** です(`tournamentId` を条件に含めて引いているため、権限のある大会のジョブしか読めません)。

- `200`: `StaffMailJob` = `{"jobId", "subject", "total", "sent", "failed", "createdAt", "updatedAt"}`
- `400`: `jobId` が UUID でない
- `404`: `{"error": "mail job not found"}`
- `401` / `403` / `500`

`sent + failed` が `total` に達していれば送信は終わっています。まだなら送信中(またはレート制限で再配信待ち)です。`updatedAt` はコンシューマが結果を書き込むたびに動くので、時間の掛かっている送信と止まっている送信を区別できます。スタッフが書いた本文は返しません。送信中にポーリングされる想定で、呼び出し側が既に持っている 20000 文字を毎回返す必要がないためです。

## 11. 全地域横断ダッシュボード(統括スタッフ)

`routes/staff-dashboard.ts`。セクション 10 のエントリー閲覧・メール送信が「1 大会ずつ」なのに対し、こちらは**全地域・全大会の集計を 1 回で**返します。地域スタッフには自分の地域外の情報を見せないため、`requireStaffForTournament()` ではなく `requireGeneralStaff()` で保護しています(地域スタッフは 403)。

### `GET /api/staff/dashboard`

- `200`: `DashboardTournamentSummary[]`(大会の表示順。`PUT /api/tournaments/order`)
- `401` / `403` / `500`

| フィールド | 内容 |
| --- | --- |
| `tournamentId` / `tournamentName` / `tournamentType` | 大会の識別子・名称・種別 |
| `regionId` / `regionSlug` / `regionName` | 大会が属する地域。`regionSlug` と `tournamentType` で `/staff/:regionSlug/:tournamentSlug/entries` へ遷移できます |
| `capacity` | 定員。`null` は定員なし |
| `confirmedCount` / `waitlistedCount` / `pendingVerificationCount` / `cancelledCount` | ステータス別のエントリー件数 |

集計は DB 関数 `tournament_entry_summary()`(`supabase/migrations/0013_...`)が行い、ルートは `db.rpc()` で 1 回呼ぶだけです。Worker 側で数えると「大会ごとに 1 クエリ」か「全地域の `entries` を丸ごと取得」のどちらかになるため、集計は DB に寄せています。エントリーが 0 件の大会も件数 0 の行として返るので、まだ誰も申し込んでいない大会が一覧から消えることはありません。

充足率(`confirmedCount / capacity`)は API では返さず、`packages/shared` の `calculateFillRate()` をフロントエンドと共有しています。席を占めるのは `confirmed` のみで、キャンセル待ち・メール確認待ちは充足率に含めません。

行数は「大会数(地域数 × 大会種別)」に等しく Supabase の `max_rows` に届かないため、CSV エクスポートのようなページングは行っていません。

## 12. スタッフアカウント管理(統括スタッフ)

`routes/staff-accounts.ts`。スタッフの発行を Supabase の直接操作から引き上げるためのエンドポイント群です。`password_hash` は `lib/password.ts` の PBKDF2 形式なので、この API が無い間はアプリのコードを動かさないとスタッフ 1 人すら増やせませんでした。

**初期パスワードは API が決めず、レスポンスにも載せません。** 作成時はログインできない行を作り、本人のメールアドレスへ送ったワンタイムリンク(上記 `POST /api/auth/staff/password-reset/confirm`)で本人に設定させます。統括スタッフが地域スタッフのパスワードを知っている状態を作らないためです。

ガードは `routes/regions.ts` と違い**ルート単位**で付けています。このサブアプリは `/staff` にマウントされており、同じ `/staff` に地域スタッフも使う `routes/staff-entries.ts` / `routes/staff-mail.ts` がマウントされているため、`.use('*', ...)` にすると地域スタッフが自分のエントリー一覧から締め出されます。

**削除は提供せず、無効化で扱います**(#156)。`entries` など既存データからスタッフを参照する外部キーは無いので削除もできますが、行を消すと誰がどの大会を担当していたかも消え、誤操作を戻せません。無効化なら行もパスワードも残り、有効化すれば元どおり使えます。

### `GET /api/staff/accounts`

全スタッフアカウントを `created_at` 昇順で返します。

- `200`: `StaffAccount[]` — `{id, email, role, regionId, regionSlug, regionName, tournamentType, passwordSet, disabledAt}`(`disabledAt` は無効化された時刻、有効なら `null`)
- `401` / `403`
- `500`: `{"error": "internal server error"}`

`password_hash` は**返しません**。行からは `passwordSet`(招待リンクがまだ使われていなければ `false`)だけを組み立てます。誰にリンクを送り直すべきかは管理画面が知る必要があり、ハッシュそのものは必要ないためです。

`regionSlug` / `regionName` は join した `regions` の値で、`general` スタッフでは `regionId` ともども `null` です。

### `POST /api/staff/accounts`

- リクエスト: `StaffAccountCreateInputSchema` — `role` による判別共用体
  - `{role: 'general', email}`
  - `{role: 'regional', email, regionId, tournamentType}`
- `201`: 作成された `StaffAccount`(`passwordSet` は必ず `false`)
- `400`: バリデーション違反(`zValidator`)、または `{"error": "unknown region"}`(存在しない `regionId` = Postgres の `23503`)
- `409`: `{"error": "email already in use"}`(Postgres の `23505`。同じアドレスで同じ担当種別のアカウント、または同じアドレスの統括スタッフが既にある)

一意なのは `(email, tournament_type)` の組です(#166)。同じアドレスで最強位と新人王のアカウントを 1 つずつ作れます。統括スタッフ(`tournament_type` が null)はアドレスごとに 1 つです。アドレスは小文字にしてから保存します(#133)。
- `401` / `403`
- `500`: `{"error": "internal server error"}`、またはメール送信に失敗した場合の `{"error": "account created but the setup mail could not be sent"}`

このエンドポイント自体が統括スタッフ限定なので、環境の**最初の統括スタッフはこれでは作れません**。SQL Editor から作る手順は `docs/supabase-deployment.md` 8.1 にあります。

`regional` は `regionId` と `tournamentType` の**両方が必須**、`general` は**両方持てません**。片方だけ埋まった行は「狭い担当範囲」ではなく壊れた行で、`middleware/staff-auth.ts` の範囲チェックがすべての大会で落ちるため、そのアカウントはどこへ行っても静かに 403 になります。判別共用体はこの body を型の側で作れなくし、同じ不変条件を DB の check 制約(`staff_accounts_scope_matches_role`)でも縛っています。

行の `password_hash` には、`hashPassword()` の形式に合わない固定値(`UNUSABLE_PASSWORD_HASH`)を入れます。`verifyPassword()` は形式が合わない文字列に対して常に false を返すので、招待リンクでパスワードが設定されるまでこのアカウントではログインできません。

招待メールは参加者の再設定要求と違い `waitUntil()` に逃がさず **await** し、失敗はステータス 500 で報告します。呼び出し元は認証済みの統括スタッフで、列挙されるアドレスも隠すべき結果もない一方、「アカウントは出来たがリンクが飛んでいない」ことは知らせないと運用が詰まるためです。この場合のメッセージが `internal server error` ではないのはそのためで、やり直すべきは作成(もう 409 になります)ではなくリンクの再発行です。

### `POST /api/staff/accounts/:id/password-reset`

パスワード設定リンクの再発行。招待メールが届かなかった場合と、スタッフがパスワードを忘れた場合の両方に使います。

- パス: `id` は UUID
- `200`: `{"ok": true}`
- `400`: バリデーション違反(`zValidator`)
- `404`: `{"error": "staff account not found"}`
- `409`: `{"error": "staff account disabled"}`(無効化されたアカウント。先に有効化してください。判定は DB 関数 `issue_staff_password_link()`(`0027`)がアカウント行をロックしてから行い、古いリンクの削除と新しいリンクの追加も同じトランザクションで行うので、無効化と同時に走っても無効なアカウントにリンクが残ることはありません)
- `401` / `403`
- `500`: `{"error": "internal server error"}`

**送信先は body ではなく行から読みます。** リンクはそのアカウント自身のメールボックスにしか送られてはならないので、呼び出し側に指定させる余地を作っていません。

リンクの有効期限は 24 時間です(参加者の再設定リンクの 1 時間より長め)。招待は本人が待っている操作ではないため、1 時間ではほとんどが読まれる前に切れてしまいます。発行のたびに、そのアカウントの期限切れトークンは削除され、設定が成功した時点で残りの未使用リンクも焼き捨てられます。

**スタッフ自身がリンクを要求する経路はありません**(`/request` に相当するものが無い)。統括スタッフが 1 人しかいない状態でその人がパスワードを忘れると、Supabase を直接操作するしかありません。運用上、統括スタッフは 2 名以上作ってください。

### `POST /api/staff/accounts/:id/revoke-sessions`

そのアカウントの**発行済みセッションをすべて無効化**します(Task 11-3)。`staff_accounts.sessions_valid_from` を現在時刻に進めるだけで、スタッフ用ミドルウェアは各セッションの `sessionsValidFrom` クレームとこの列を毎リクエスト突き合わせるため、それ以前に発行された Cookie は**次のリクエストから 401** になります。端末の紛失や Cookie の漏洩など、**Cookie だけが手元を離れた**場合に使います。

- パス: `id` は UUID
- `200`: `{"ok": true}`
- `400`: バリデーション違反(`zValidator`)
- `404`: `{"error": "staff account not found"}`
- `401` / `403`(`regional` スタッフは不可)
- `500`: `{"error": "internal server error"}`

**パスワードは変えません。** パスワードを知っていれば誰でもそのまま再ログインできるので、**退任者やパスワードごと漏れた相手を締め出す手段にはなりません**。`password-reset` でリンクを再発行してもそのリンクは本人のアドレスに届くため、退任者本人は止められません。その場合は下記の `disable` を使います。

管理画面(`/admin/staff`)のボタンは、押すと確認ダイアログを出してから送信します。

**自分自身のアカウントも対象にできます。** 端末を失くしたスタッフが手元の別の端末から押せるようにするためです。その場合、このリクエスト自体は 200 で通りますが、呼び出し元のセッションも同じアカウントのものなので次のリクエストからは 401 になります。管理画面(`/admin/staff`)はこのケースを見分け、Cookie を消してそのままログイン画面へ送ります。

新しい値は Postgres の `now()` ではなく Worker の時計で書いています(PostgREST 経由の UPDATE では `now()` を指定できないため)。判定は「発行時刻より後か」ではなく値の一致なので、時計がずれていても値が変わりさえすれば足ります。

### `POST /api/staff/accounts/:id/disable`

アカウントを**無効化**します(#156)。退任したスタッフや、パスワードごと漏れたかもしれないアカウントを締め出すためのものです。

- パス: `id` は UUID
- `200`: `{"ok": true}`(既に無効なアカウントでも 200。`disabledAt` は最初に無効化した時刻のまま)
- `400`: バリデーション違反(`zValidator`)
- `404`: `{"error": "staff account not found"}`
- `409`: `{"error": "cannot disable your own account"}`(自分自身)、`{"error": "cannot disable the last general staff account"}`(有効な統括スタッフが残らなくなる)
- `401` / `403`
- `500`: `{"error": "internal server error"}`

無効化すると、DB 関数 `disable_staff_account()`(`supabase/migrations/0026_...`)が 1 トランザクションで次を行います。

- `staff_accounts.disabled_at` を設定する。以後のログインは、パスワードが正しくても 401 です
- `sessions_valid_from` を進めて、発行済みのセッションを次のリクエストから 401 にする(スタッフ用ミドルウェアは `disabled_at` も見ているので、列が戻されても通りません)
- 未使用のパスワード設定リンクを削除する。`reset_staff_password()` も無効なアカウントへの設定を拒否するので、無効化と同時に使われたリンクも通りません

**自分自身は無効化できません。** 統括スタッフが自分を締め出すと、ほかの統括スタッフしか戻せず、最後の 1 人なら誰も戻せないためです。加えて関数側でも、**有効な統括スタッフが 0 人になる無効化を拒否します**。統括スタッフの行をすべてロックしてから数えるので、2 人が同時に互いを無効化した場合も後の方が 409 になります。

### `POST /api/staff/accounts/:id/enable`

無効化したアカウントを**有効に戻します**。パスワードは無効化前のままなので、本人はそのパスワードでログインできます。無効化で切れたセッションは戻りません(`sessions_valid_from` は動かさない)。処理は DB 関数 `enable_staff_account()`(`0027`)がアカウント行をロックして 1 トランザクションで行い、有効に戻すと同時にそのアカウントに残っているパスワード設定リンクを削除します。無効だった間のリンクを有効化で再び使えるようにしないためです(必要なら有効化の後に再送します)。**既に有効なアカウントには何もせず**(リンクも消さず)200 を返します。古い画面から押された「有効化」が、別の統括スタッフが送ったばかりのリンクを消さないようにするためです。

- パス: `id` は UUID
- `200`: `{"ok": true}`
- `400`: バリデーション違反(`zValidator`)
- `404`: `{"error": "staff account not found"}`
- `401` / `403`
- `500`: `{"error": "internal server error"}`

## 13. マイページ(参加者本人)

`routes/mypage.ts`。このサブアプリは `.use('*', requireParticipant())` により全ルートが参加者ログイン必須です。

すべてのクエリは `participant_id` をセッションの値で絞り込みます。**他人のエントリーは「存在しないエントリー」と同じ 404 になり、両者を区別できません。**

### `GET /api/mypage/entries`

ログイン中の参加者のエントリー一覧(複数大会にまたがる)。

- `200`: `MypageEntry[]` — `{id, tournamentId, status, waitlistPosition, tournament: {name, type, regionId, entryOpensAt, entryClosesAt}}`
- `500`

公開リストと違い、`pending_verification` を含む全ステータスを返します。エントリー期間を一緒に返しているのは、一覧側で「まだ編集できるか」を各件を個別取得せずに判定できるようにするためです(共有ロジック `isEntryEditable()`)。

### `GET /api/mypage/entries/:entryId`

編集画面のプリフィル用の詳細。

- `200`: `MypageEntryDetail` = `MypageEntry` + `{name, furigana, displayName, regulationLabels, freeText, customFieldValues, formFieldDefs}`
- `404`: `{"error": "entry not found"}`
- `500`

### `PATCH /api/mypage/entries/:entryId`

参加者自身による編集。処理の本体は `lib/entries.ts` の `updateOwnEntry()`。

- リクエスト: `EntryEditInputSchema` — `{name, furigana, displayName, freeText?, customFieldValues}`
- `200`: `{"ok": true}`

編集可能なのはこの5項目だけです。`email` / `password` はアカウント資格情報なので認証フロー側で変更し、`regulationIds` はエントリー時点の優先期間に基づいて検証済みのため変更できません。

| ステータス | `error` | 条件 |
| --- | --- | --- |
| 404 | `entry not found` | 存在しない、または他人のエントリー |
| 403 | `entry period closed` | エントリー期間外 |
| 403 | `entry is cancelled` | キャンセル済み(編集可能なのは `pending_verification` / `confirmed` / `waitlisted`) |
| 400 | `unknown custom field: ...` 等 | 追加項目の回答が大会のフォーム定義と整合しない |
| 500 | | 検索・更新の失敗 |

`customFieldValues` はクライアントの申告を信用せず、サーバ側で当該大会の `form_field_defs` を取得して `findCustomFieldValuesError()` で検証します(未定義キー、選択肢にない値、必須項目の空欄、型の不一致を弾きます)。

### `DELETE /api/mypage/entries/:entryId`

参加者自身によるキャンセル。処理の本体は `lib/entries.ts` の `cancelOwnEntry()` で、DB 関数 `cancel_own_entry()` を呼びます。

- `200`: `{"ok": true}`
- `404`: `{"error": "entry not found"}`
- `500`

挙動:

- `confirmed` をキャンセルした場合は、続けて `promoteWaitlistedEntries()` を呼び、空いた席の数だけキャンセル待ちの先頭から繰り上げて通知メールを送ります。ただしその席に別のエントリーが先に確定していた場合は誰も繰り上げません。
- `waitlisted` をキャンセルした場合は、後続の順位を詰めるだけです。
- すでに `cancelled` の場合も 200 を返します(冪等)。誰も繰り上げません。
- 繰り上げ処理が失敗しても**リクエスト自体は成功扱い**にし、ログ出力にとどめます。キャンセル自体は既にコミット済みであり、ここで失敗を返すと「キャンセルできていない」と参加者に誤解させるためです。失われるのは繰り上げ(またはその通知メール)だけで、参加者のキャンセル自体は成立しています。取りこぼした繰り上げは、次のキャンセルか、統括スタッフが大会の編集画面で定員を保存し直したときに回収されます(空席の数を数えて繰り上げるため。#223)。

## 14. 環境変数(Bindings)

`apps/backend/src/types/env.ts`。Cloudflare Workers の Bindings 経由で渡します。

| 変数 | 秘匿 | 用途 |
| --- | --- | --- |
| `SUPABASE_URL` | | Supabase プロジェクトの URL |
| `SUPABASE_SECRET_KEY` | ✅ | RLS を貫通する Supabase の secret key(`sb_secret_...`)。フロントエンドに渡さないこと |
| `SESSION_SECRET` | ✅ | セッション JWT の HS256 署名鍵 |
| `MAIL_API_KEY` | ✅ | Resend の API キー |
| `MAIL_API_BASE_URL` | | メール送信 API のオリジン。**本番では設定しません**(未設定なら Resend 本体 `https://api.resend.com`)。`apps/e2e` の E2E テストだけがローカルの stub を指すために設定します |
| `MAIL_FROM_ADDRESS` | | 送信元アドレス |
| `GOOGLE_SHEETS_API_KEY` | ✅ | Google Sheets API v4 の API キー |
| `FRONTEND_URL` | | フロントエンドの URL。メール本文中のリンク(確認リンク等)の組み立てと、状態変更リクエストの Origin 検証(「CSRF 対策(Origin 検証)とセキュリティヘッダ」参照)に使う |
| `CSRF_TRUSTED_ORIGINS` | | 任意。`FRONTEND_URL` 以外に Origin 検証で許すオリジン(カンマ区切り)。ローカル開発では `dev` スクリプトが `http://127.0.0.1:5173` を渡す。通常の staging / production では設定しない |
| `CLIENT_IP_FORWARD_SECRET` | ✅ | 任意。フロントエンドと共有するシークレット。一致したリクエストに限り `X-Client-IP` を IP 鍵に使う(1 章「レート制限と Turnstile」)。未設定ならヘッダーを信用しない。フロントエンド側にも**同じ値**を登録する |
| `TURNSTILE_SECRET_KEY` | ✅ | Turnstile の siteverify に渡すシークレット。`[env.*.vars]` には**置かない**(同名の var はシークレットを上書きします) |
| `LOGIN_IP_RATE_LIMITER` | | Rate Limiting binding。ログイン 2 本に IP 単位で 10 回 / 60 秒 |
| `LOGIN_EMAIL_RATE_LIMITER` | | Rate Limiting binding。ログイン 2 本にアカウント単位で 60 回 / 60 秒 |
| `MAIL_TRIGGER_IP_RATE_LIMITER` | | Rate Limiting binding。メールを送る 2 本に IP 単位で 20 回 / 60 秒 |
| `MAIL_TRIGGER_EMAIL_RATE_LIMITER` | | Rate Limiting binding。メールを送る 2 本に宛先単位で 3 回 / 60 秒 |

登録手順は [`supabase-deployment.md`](./supabase-deployment.md) / [`google-sheets-integration.md`](./google-sheets-integration.md) を参照してください。

## 15. 未実装のエンドポイント

`tasks.md` 上で計画されているが、現時点で API が存在しないものです。

現時点ではありません。レギュレーションの登録・編集(6 章)、スタッフアカウントの管理(12 章)はいずれも API 化済みです。
