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
| `staff_session` | スタッフ | 12 時間 | `sub`, `role`, `regionId`, `tournamentType`, `exp` |
| `participant_session` | 参加者 | 7 日間 | `sub`, `pwdChangedAt`, `iat`, `exp` |

Cookie 属性は `httpOnly` / `secure` / `sameSite: 'Lax'` です。

検証時の注意点として、`hono/jwt` の `verify()` は `exp` クレームが**存在するときだけ**期限を検証します。そのため各ミドルウェアは「`exp` が number であること」を明示的に確認しています。これがないと、`exp` を持たない正しく署名されたトークンが無期限のセッションとして通ってしまいます。

参加者セッションだけは署名の検証に加えて **DB 参照が 1 回入ります**。`pwdChangedAt` はログイン時点の `participants.password_changed_at`(エポックミリ秒)で、`requireParticipant()` が毎リクエストその列を読み直し、**値が動いていたら 401** にします。パスワード再設定でこの列が更新されるため、再設定前に発行された Cookie(盗まれたものを含む)はその時点で使えなくなります。ステートレスな JWT のままだと、パスワードを変えても攻撃者のアクセスが最大 7 日間続いてしまいます。

比較を「発行時刻より後か」ではなく**同じ列の値どうしの一致**にしているのは、Worker と Postgres の時計ずれで登録直後・再設定直後のログインが自分のセッションで 401 になるのを避けるためです。

### 認可ミドルウェア

`apps/backend/src/middleware/` に3種類のスタッフ用ミドルウェアと1種類の参加者用ミドルウェアがあります。

| ミドルウェア | 条件 | 失敗時 |
| --- | --- | --- |
| `requireGeneralStaff()` | 有効な `staff_session` かつ `role === 'general'` | 401 / 403 |
| `requireStaffForTournament()` | 有効な `staff_session`。`general` なら無条件通過、`regional` なら `:tournamentId` の大会が担当範囲(`region_id` と `type` が両方一致)であること | 401 / 403 / 500 |
| `requireStaffForEntry()` | 同上。ただし `:entryId` から `tournament_id` を辿って範囲を判定する | 401 / 403 / 500 |
| `requireParticipant()` | 有効な `participant_session`。加えて `pwdChangedAt` クレームが `participants.password_changed_at` と一致すること(パスワード再設定でセッションが切れる) | 401 / 500 |

> **ルーティング上の注意**: `routes/tournaments.ts` はミドルウェアを `.use('*', ...)` ではなく**ルート単位**で付けています。このサブアプリは `/tournaments` にマウントされており、同じ `/tournaments` に公開ルート(`routes/entries.ts` / `routes/entry-list.ts`)もマウントされているためです。Hono はミドルウェアを「どのサブアプリで登録されたか」ではなく**リクエストの最終パス**でマッチさせるので、ワイルドカードを使うと公開ルートまで認証必須になってしまいます。

> **登録順の依存**: `index.ts` では `entryListRoute` を `tournamentsRoute` より先にマウントしています。`GET /tournaments/:tournamentId/entry-list` と `GET /tournaments/:regionSlug/:tournamentSlug` はどちらも2セグメントのパターンなので、順序を入れ替えると公開エントリーリストが大会取得ルートに吸われます。

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

| メソッド | パス | 認可 |
| --- | --- | --- |
| GET | `/api/healthz` | なし |
| POST | `/api/auth/staff/login` | なし |
| POST | `/api/auth/participant/login` | なし |
| POST | `/api/auth/participant/password-reset/request` | なし |
| POST | `/api/auth/participant/password-reset/confirm` | なし(トークン) |
| GET | `/api/tournaments` | 統括スタッフ |
| POST | `/api/tournaments` | 統括スタッフ |
| PATCH | `/api/tournaments/:id` | 統括スタッフ |
| GET | `/api/tournaments/:regionSlug/:tournamentSlug` | なし |
| GET | `/api/tournaments/:tournamentId/entry-list` | なし |
| POST | `/api/tournaments/:tournamentId/entries` | なし |
| GET | `/api/entries/verify` | なし(トークン) |
| PUT | `/api/form-definitions/:tournamentId` | 統括スタッフ |
| POST | `/api/sheet-import/preview` | 統括スタッフ |
| GET | `/api/staff/tournaments/:tournamentId/entries` | スタッフ(担当範囲) |
| GET | `/api/staff/tournaments/:tournamentId/entries.csv` | スタッフ(担当範囲) |
| GET | `/api/staff/entries/:entryId` | スタッフ(担当範囲) |
| GET | `/api/mypage/entries` | 参加者 |
| GET | `/api/mypage/entries/:entryId` | 参加者(本人) |
| PATCH | `/api/mypage/entries/:entryId` | 参加者(本人) |
| DELETE | `/api/mypage/entries/:entryId` | 参加者(本人) |

## 3. ヘルスチェック

### `GET /api/healthz`

疎通確認用。`200 {"ok": true}` を返すだけです。

## 4. 認証

### `POST /api/auth/staff/login`

スタッフのログイン。成功時に `staff_session` Cookie を発行します。

- リクエスト: `StaffLoginInputSchema` — `{email: string(email), password: string(min 1)}`
- `200`: `{"ok": true, "role": "regional" | "general"}`
- `401`: `{"error": "invalid credentials"}`
- `500`: `{"error": "internal server error"}`

該当アカウントが存在しない場合もダミーのハッシュに対して PBKDF2 を実行してから 401 を返します。これにより「メールアドレスが存在しない」場合と「パスワードが違う」場合の応答時間が揃い、タイミング差からのアカウント列挙を防ぎます。

### `POST /api/auth/participant/login`

参加者のログイン。成功時に `participant_session` Cookie を発行します。

- リクエスト: `ParticipantLoginInputSchema` — `{email, password}`
- `200`: `{"ok": true}`
- `401` / `500`: スタッフ側と同じ(ダミーハッシュによる時間平準化も同様)

発行する JWT には `sub` / `exp` に加えて `pwdChangedAt`(このログインで照合したパスワードの `password_changed_at`)を載せます。追加のクエリは不要で、パスワードハッシュと同じ SELECT で取得しています。

### `POST /api/auth/participant/password-reset/request`

参加者のパスワード再設定リンクの送信要求。`lib/password-reset.ts` の `requestPasswordReset()` が、該当する参加者がいれば使い捨てトークン(有効期限 1 時間)を `password_reset_tokens` に発行し、`FRONTEND_URL/password-reset?token=...` へのリンクをメールで送ります。トークンは Task 3-4 のメール確認トークンと同じく SHA-256 ハッシュのみを保存し、生のトークンは受信者のメールボックスにしか存在しません。

- リクエスト: `PasswordResetRequestInputSchema` — `{email: string(email)}`
- `200`: `{"ok": true}`
- `400`: メール形式が不正(zValidator)

メールアドレスが未登録の場合、トークンの保存に失敗した場合、メール送信に失敗した場合のいずれも、送信できた場合と同じ `200 {"ok": true}` を返します。内部的な失敗は `console.error` に記録されます。

レスポンスが同じでも、**かかる時間が同じでなければ**メールアドレスの列挙に使えてしまいます(未登録なら SELECT 1 回、登録済みならハッシュ化・INSERT・Resend への往復が加わり、通常 100〜500ms 差が出ます)。そのためルートは `requestPasswordReset()` を `await` せず `c.executionCtx.waitUntil()` に渡し、**上記の処理を一切始めないうちに** 200 を返します。この関数は結果を呼び出し元に返さないので、待つ必要もありません。

発行時には、その参加者の**期限切れトークンを削除**します。`/request` は未認証・レート制限なしで 1 回ごとに 1 行増えるため、これがないと `password_reset_tokens` が無制限に育ちます。なお**レート制限そのものは未実装**です(メール爆撃・Resend のクォータ消費は防げません)。

### `POST /api/auth/participant/password-reset/confirm`

トークンと新しいパスワードを受け取り、パスワードを再設定します。

- リクエスト: `PasswordResetConfirmInputSchema` — `{token: string(min 1), newPassword: string(min 8)}`
- `200`: `{"ok": true}`
- `400`: `{"error": "invalid or expired token"}`(未知・使用済み・期限切れのトークン)
- `500`: `{"error": "internal server error"}`

未認証で叩けるエンドポイントなので、スタッフ/参加者ログインと同様に Supabase のメッセージはレスポンスに含めず `console.error` に記録するだけにしています。

トークンの検証・パスワード更新・残りトークンの焼き捨ては、DB 関数 `reset_participant_password()` が 1 トランザクションで行います(`supabase/migrations/0011_participants_password_changed_at.sql`)。まず**参加者行を `for update` でロック**し、そのロックの下でトークン行を読み直して使用済み・期限切れを判定するため、同じ参加者宛ての同時リクエストは直列化され、2 番目は `used_at` 済みとして 400 になります。詳細は [`database-schema.md`](./database-schema.md#reset_participant_passwordp_token_hash-p_password_hash) を参照してください。

再設定に成功すると、その参加者に対して残っている他の未使用トークンもまとめて使用済みにします。同じトランザクションなので、焼き捨てに失敗すればパスワード更新ごとロールバックされます。

同じ UPDATE 文で `participants.password_changed_at` も打刻され、**その参加者の既存セッションがすべて無効になります**。参加者セッションは 7 日有効なステートレス JWT なので、これがないと Cookie を盗まれた参加者がパスワードを変えても攻撃者のアクセスは最大 7 日間続きます。

## 5. 大会管理(統括スタッフ)

`routes/tournaments.ts`。camelCase の API 形状と snake_case のカラム名の相互変換はこのファイル内の `rowToTournament()` / `toTournamentRow()` が担当します。

### `GET /api/tournaments`

全大会を返します。

- `200`: `Tournament[]`
- `500`: `{"error": <Supabase のメッセージ>}`

### `POST /api/tournaments`

- リクエスト: `TournamentSchema.omit({id: true})` — `{regionId, type, name, capacity, entryOpensAt, entryClosesAt}`
  - `capacity` は `null` 可(定員無制限)。
  - `entryOpensAt` / `entryClosesAt` はオフセット付き ISO 8601 文字列。
- `201`: 作成された `Tournament`
- `400`: `{"error": ...}`

### `PATCH /api/tournaments/:id`

- パス: `id` は UUID
- リクエスト: 上記の全フィールドを部分適用(`.partial()`)
- `200`: 更新後の `Tournament`
- `404`: 対象が存在しない(Supabase の `PGRST116` を 404 に変換)
- `400`: それ以外の更新失敗

### `GET /api/tournaments/:regionSlug/:tournamentSlug`

公開ルート。地域スラッグと大会種別スラッグの組から大会を1件引きます。`regions` を slug で引いてから `tournaments` を `(region_id, type)` で引く2段階のクエリです。

- パス: `tournamentSlug` は `'saikyoi' | 'shinjinou'`
- `200`: `Tournament`
- `404`: `{"error": "tournament not found"}`(地域が無い場合も同じ応答)
- `500`

## 6. エントリー(参加者向け)

### `POST /api/tournaments/:tournamentId/entries`

エントリーの新規登録。処理の本体は `apps/backend/src/lib/entries.ts` の `createEntry()` です。

- リクエスト: `EntryInputSchema`

  | フィールド | 型 | 備考 |
  | --- | --- | --- |
  | `name` | string(min 1) | 氏名 |
  | `furigana` | string(min 1) | ふりがな |
  | `displayName` | string(min 1) | 公開リスト掲載名 |
  | `email` | string(email) | アカウントのメールアドレス |
  | `password` | string(min 8) | |
  | `passwordConfirm` | string(min 8) | `password` と一致必須 |
  | `regulationId` | string(uuid) | |
  | `freeText` | string(任意) | |
  | `customFieldValues` | `Record<string, string \| string[]>` | 追加フォーム項目の回答 |

- `201`: `{"id": "<entry id>"}`

エラー:

| ステータス | `error` | 条件 |
| --- | --- | --- |
| 400 | `invalid tournament` | `:tournamentId` の大会が存在しない |
| 403 | `entry period closed` | エントリー期間外 |
| 403 | `regulation not eligible in priority window` | 優先期間中に対象外レギュレーションを選択した |
| 401 | `invalid password` | 既存メールアドレスでのエントリーだがパスワードが一致しない |
| 409 | `already registered in another region` | そのメールアドレスが別地域の participant として登録済み |
| 409 | `already entered` | 同じ大会にキャンセル以外のエントリーが既にある |
| 409 | (Supabase のメッセージ) | participant / entry の作成に失敗 |
| 500 | `failed to send verification email: ...` | 確認メールの送信に失敗 |

処理の流れ:

1. 大会とそのレギュレーション群を取得し、エントリー期間・優先期間を検証。
2. メールアドレスから participant を検索。既存なら**パスワード照合**、無ければ新規作成(PBKDF2 でハッシュ化)。
3. 同じ大会の既存エントリーを確認。`cancelled` なら**その行を再利用**して上書き(`unique (participant_id, tournament_id)` があるため2行目は作れない)、それ以外なら 409。
4. 確認メールを送信。

> **現状の注意点**: `customFieldValues` は `EntryInputSchema` で形(`Record<string, string | string[]>`)しか検証されておらず、**その大会の `form_field_defs` との照合は行われていません**。照合を行う `findCustomFieldValuesError()` を呼んでいるのは編集側(`PATCH /api/mypage/entries/:entryId`)だけです。

メール送信に失敗した場合はエントリーを**ロールバック**します。放置すると、参加者は使えるリンクを受け取っていないのに一意制約や「already entered」で再試行を永久に阻まれるためです。ロールバックは「確認トークンの削除 → 新規行なら削除 / 再利用行なら元の値へ復元」の順に行います(トークンが FK で参照している間はエントリーを削除できないため)。再利用行は削除ではなく**キャンセル状態へ復元**することで、元のエントリーの記録が消えないようにしています。

### `GET /api/entries/verify?token=...`

メール本文の確認リンクから叩かれるエンドポイント。DB 関数 `confirm_entry_by_token()` を呼び、エントリーを確定またはキャンセル待ちに載せます。

- クエリ: `token`(非空文字列。生トークン。サーバ側で SHA-256 化して照合)
- `200`: `{"status": "confirmed" | "waitlisted"}`
- `400`: `{"error": "invalid or expired token"}` — 未知 / 期限切れ(発行から24時間)/ 使用済みトークン、またはエントリーが `pending_verification` でなくなっている場合

定員に空きがあれば `confirmed`、埋まっていれば `waitlisted`(順位付き)になります。

## 7. 公開エントリーリスト

### `GET /api/tournaments/:tournamentId/entry-list`

認証不要の公開エンドポイント。`created_at` 昇順で返します。

- `200`: `EntryListItem[]` — `{displayName: string, status: 'confirmed' | 'waitlisted' | 'cancelled', waitlistPosition: number | null}`
- `500`

個人情報保護の観点から、以下の設計になっています。

- 返すのは掲載名・ステータス・キャンセル待ち順位の**3項目のみ**。`name` / `furigana` / `email` / `freeText` / `customFieldValues` は一切含みません(`EntryListItemSchema` がそれを型で保証しています)。
- `pending_verification` のエントリーは除外します(メール確認前の申し込みを公開しないため)。
- `cancelled` の行は削除せず、`displayName` を `"キャンセル"` に**マスクして返します**。行自体を落とさないのは、繰り上げ処理が更新するのは繰り上がった側の行だけで、キャンセルされた行はそのまま残るためです。

## 8. フォーム定義管理(統括スタッフ)

詳細な仕組みは [`form-generation.md`](./form-generation.md) を参照してください。

### `PUT /api/form-definitions/:tournamentId`

YAML テキストを受け取り、その大会の `form_field_defs` を丸ごと置き換えます。

- リクエスト: `FormDefinitionUploadSchema` — `{yaml: string}`(**パース前の生テキスト**)
- `200`: `{"ok": true}`
- `400`: `{"error": <YAML パース/検証エラーのメッセージ>}`
- `404`: `{"error": "tournament not found"}`
- `500`: `{"error": "internal server error"}`

500 を返す場合、Supabase の生のエラーメッセージはクライアントに返さずサーバログにのみ出力します。

### `POST /api/sheet-import/preview`

Google スプレッドシートを読み取り、フォーム定義 YAML を生成して返します。**この時点では DB に何も書き込みません。** 保存は上記の `PUT /api/form-definitions/:tournamentId` を別途呼びます。

- リクエスト: `SheetImportRequestSchema` — `{spreadsheetId: string, tournamentSlug: string}`
- `200`: `{"yaml": "..."}`

エラーは失敗の原因によって切り分けています。

| ステータス | 条件 |
| --- | --- |
| 400 | スプレッドシート ID が不正・シートにアクセスできない(Google からの 4xx)、行データが `FormFieldDefYamlSchema` に合わない、`type` 列が既定のラベルでない、`options` 列に重複がある |
| 502 | Google への接続失敗(ネットワークエラー)または Google からの 5xx |
| 503 | Google からのレート制限(429) |

詳細は [`google-sheets-integration.md`](./google-sheets-integration.md) を参照。

## 9. スタッフ向けエントリー閲覧

`routes/staff-entries.ts`。`requireStaffForTournament()` / `requireStaffForEntry()` により、地域スタッフは担当大会のエントリーしか見られません。統括スタッフは全件見られます。

### `GET /api/staff/tournaments/:tournamentId/entries`

- `200`: `Entry[]`(`created_at` 昇順)

`Entry` は `id` / `tournamentId` / `name` / `furigana` / `displayName` / `email` / `regulationId` / `regulationLabel` / `freeText` / `customFieldValues` / `status` / `waitlistPosition` を含みます。`email` は `participants` の、`regulationLabel` は `regulations` の JOIN 結果です。

- `401` / `403` / `500`

### `GET /api/staff/tournaments/:tournamentId/entries.csv`

エントリー一覧の CSV エクスポート。一覧エンドポイントと同じ範囲(当該大会の全エントリー、`created_at` 昇順)を CSV で返します。

- `200`: `text/csv; charset=utf-8` / `Content-Disposition: attachment; filename="entries-<tournamentId>.csv"`
- `401` / `403` / `500`

| 項目 | 内容 |
| --- | --- |
| 列 | `氏名` / `ふりがな` / `掲載名` / `ステータス` + 当該大会の追加項目(`form_field_defs` の `label` を見出しに、`display_order` 昇順) |
| 改行 | CRLF(RFC 4180)。末尾に改行は付けません |
| エンコーディング | UTF-8 + BOM。BOM がないと Excel(Windows)が日本語列を文字化けさせるため |
| ステータス | `ENTRY_STATUS_LABELS`(共有)による日本語表記。スタッフ画面の表示と同じ文言です |
| 追加項目の値 | 複数選択チェックボックスは選択肢を `;` で連結。単独ブールチェックボックスは `はい` / `いいえ`(スタッフ詳細画面と同じ)。回答がない項目は空セル |

追加項目の列は現在のフォーム定義から組み立てるため、エントリー後に項目名を変えた場合は新しい `label` で出力されます。逆に、フォームから削除された項目の回答は出力されません(見出しのない列を作らないため)。

生成ロジックは `apps/backend/src/lib/entries-csv.ts` の `buildEntriesCsv()`。スタッフ画面のエントリー一覧にはこのエンドポイントへのダウンロードリンクがあります。

### `GET /api/staff/entries/:entryId`

1件の詳細。

- `200`: `StaffEntryDetail` = `Entry` + `formFieldDefs: FormFieldDef[]`
- `404`: `{"error": "entry not found"}`
- `401` / `403` / `500`

`formFieldDefs` は当該大会のフォーム項目定義を `display_order` 昇順で返すものです。これがないと、スタッフ画面は `customFieldValues` を `t_shirt_size` のような生のキーでしか表示できません。一覧エンドポイントは追加項目の回答を描画しないため、`formFieldDefs` を返しません。

## 10. マイページ(参加者本人)

`routes/mypage.ts`。このサブアプリは `.use('*', requireParticipant())` により全ルートが参加者ログイン必須です。

すべてのクエリは `participant_id` をセッションの値で絞り込みます。**他人のエントリーは「存在しないエントリー」と同じ 404 になり、両者を区別できません。**

### `GET /api/mypage/entries`

ログイン中の参加者のエントリー一覧(複数大会にまたがる)。

- `200`: `MypageEntry[]` — `{id, tournamentId, status, waitlistPosition, tournament: {name, type, regionId, entryOpensAt, entryClosesAt}}`
- `500`

公開リストと違い、`pending_verification` を含む全ステータスを返します。エントリー期間を一緒に返しているのは、一覧側で「まだ編集できるか」を各件を個別取得せずに判定できるようにするためです(共有ロジック `isEntryEditable()`)。

### `GET /api/mypage/entries/:entryId`

編集画面のプリフィル用の詳細。

- `200`: `MypageEntryDetail` = `MypageEntry` + `{name, furigana, displayName, regulationLabel, freeText, customFieldValues, formFieldDefs}`
- `404`: `{"error": "entry not found"}`
- `500`

### `PATCH /api/mypage/entries/:entryId`

参加者自身による編集。処理の本体は `lib/entries.ts` の `updateOwnEntry()`。

- リクエスト: `EntryEditInputSchema` — `{name, furigana, displayName, freeText?, customFieldValues}`
- `200`: `{"ok": true}`

編集可能なのはこの5項目だけです。`email` / `password` はアカウント資格情報なので認証フロー側で変更し、`regulationId` はエントリー時点の優先期間に基づいて検証済みのため変更できません。

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

- `confirmed` をキャンセルした場合は、続けて `promoteNextWaitlistedEntry()` を呼び、キャンセル待ち先頭を繰り上げて通知メールを送ります。ただしその席に別のエントリーが先に確定していた場合は誰も繰り上げません。
- `waitlisted` をキャンセルした場合は、後続の順位を詰めるだけです。
- すでに `cancelled` の場合も 200 を返します(冪等)。誰も繰り上げません。
- 繰り上げ処理が失敗しても**リクエスト自体は成功扱い**にし、ログ出力にとどめます。キャンセル自体は既にコミット済みであり、ここで失敗を返すと「キャンセルできていない」と参加者に誤解させるためです。失われるのは繰り上げ(またはその通知メール)だけで、参加者のキャンセル自体は成立しています。なお繰り上げが走るのはこのキャンセル処理だけで(`promoteNextWaitlistedEntry()` の呼び出し元は `cancelOwnEntry()` のみ)、スタッフが繰り上げをやり直すための API / UI は現状ありません。取りこぼした繰り上げは Supabase 上で直接対応する運用です。

## 11. 環境変数(Bindings)

`apps/backend/src/types/env.ts`。Cloudflare Workers の Bindings 経由で渡します。

| 変数 | 秘匿 | 用途 |
| --- | --- | --- |
| `SUPABASE_URL` | | Supabase プロジェクトの URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | RLS を貫通する service_role キー。フロントエンドに渡さないこと |
| `SESSION_SECRET` | ✅ | セッション JWT の HS256 署名鍵 |
| `MAIL_API_KEY` | ✅ | Resend の API キー |
| `MAIL_FROM_ADDRESS` | | 送信元アドレス |
| `GOOGLE_SHEETS_API_KEY` | ✅ | Google Sheets API v4 の API キー |
| `FRONTEND_URL` | | メール本文中のリンク(確認リンク等)を組み立てるためのフロントエンド URL |

登録手順は [`supabase-deployment.md`](./supabase-deployment.md) / [`google-sheets-integration.md`](./google-sheets-integration.md) を参照してください。

## 12. 未実装のエンドポイント

`tasks.md` 上で計画されているが、現時点で API が存在しないものです。

- 参加者へのメール送信機能(Task 6-3)
- CSV 出力(Task 6-4)
- 全地域横断ダッシュボード(Task 7-1)
- レギュレーション(`regulations`)の登録・編集 API — 現状はエントリー時の検証と表示ラベルの JOIN でのみ読み出しており、書き込みは Supabase 上で直接行う運用です。
- 地域(`regions`)・スタッフアカウント(`staff_accounts`)の管理 API — 同上。
