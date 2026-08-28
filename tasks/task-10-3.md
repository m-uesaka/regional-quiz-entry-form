[← tasks.md](../tasks.md) / Phase 10: 要件との差分の解消

### Task 10-3: ログアウト機能(参加者・スタッフ) ✅

#### 実装・更新内容

* ログアウトがバックエンド・フロントエンドのどこにも存在しなかった(`logout` の文字列がコードベースに 1 件も無かった)。参加者セッションは 7 日間(`routes/participant-auth.ts`)、スタッフは 12 時間(`routes/staff-auth.ts`)の stateless JWT を httpOnly Cookie に載せているだけなので、**利用者が自分でセッションを終わらせる手段が無かった**。共用 PC や貸与端末からの離脱ができない。
* `POST /api/auth/participant/logout` と `POST /api/auth/staff/logout` を追加した。どちらも Cookie を削除するだけで、本体は同じ。認証は要求しない(未ログインでの呼び出しは 200 で無害に終わる方が、401 を返して画面側で分岐させるより素直)。
* Cookie の削除は `setCookie(..., '', {maxAge: 0})` ではなく `deleteCookie()` を使い、**発行時とまったく同じ属性(`path` / `secure` / `sameSite`)を指定する**。属性が食い違うと、ブラウザは別の Cookie とみなして元のものを消さない。各ルートで `SESSION_COOKIE_OPTIONS` を定義し、`setCookie` と `deleteCookie` の両方がそこから読むことで、片方だけが変わることを防いでいる。
* フロントエンドはレイアウトにログアウトボタンを置く。`/api/*` をブラウザから直接叩くのは Task 9-5 が終わるまで本番で 404 になるため、SvelteKit の form action 経由にして、action の中から `event.fetch` でバックエンドを呼ぶ。削除 Cookie の持ち帰りは `hooks.server.ts` の `handleFetch` が行う(下記「Cookie 転送は `handleFetch` に一本化」)。
* JWT は stateless なので、ログアウト後もトークン自体は有効期限まで署名として通る。「Cookie を消す」以上のことをするなら Task 11-3(スタッフセッションの失効)と同じ仕組みが要る。本タスクの範囲は Cookie の削除までとし、その旨をコメントに残した。

#### コードスニペット

`apps/backend/src/routes/participant-auth.ts`(追記)

```typescript
import {deleteCookie, setCookie} from 'hono/cookie';

// 発行と削除が同じ属性を読むための定数。片方だけ変わると、ブラウザは
// 別 Cookie とみなして元のセッションを消さない。
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

export const participantAuthRoute = new Hono<Env>()
  .post('/login', /* 既存。setCookie は SESSION_COOKIE_OPTIONS を展開する */)
  .post('/logout', c => {
    // JWT 自体は stateless なので、既に盗まれたトークンはこの操作では
    // 止まらない(有効期限まで通る)。それを断ち切るには
    // participants.password_changed_at と同じ「サーバ側の世代」が要る。
    deleteCookie(c, PARTICIPANT_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ok: true});
  });
```

`apps/frontend/src/routes/mypage/+page.server.ts`(追記)

```typescript
export const actions = {
  logout: async ({cookies, fetch, url}) => {
    const api = createApiClient(fetch);
    // BACKEND_URL 未設定・不正なら handleFetch が throw し、Worker に
    // 届かなければ fetch 自体が reject する。どちらもステータスを持たない
    // ので、catch しないと 500 になったうえでセッションが残る。
    const res = await api.api.auth.participant.logout.$post().catch(() => null);
    // 成功時の削除 Cookie は handleFetch が Cookie jar に載せ替えている。
    // ここで手当てが要るのは、応答が返らなかった場合だけ。
    if (!res?.ok) {
      clearParticipantSession(cookies, url);
    }
    redirect(303, PARTICIPANT_LOGIN_PATH);
  },
} satisfies Actions;
```

#### 仕様からの変更点

##### スタッフ側は `/staff/logout` を専用ルートにした

当初は参加者と同じく `/staff/...?/logout` の名前付き action を想定していたが、成立しなかった。ボタンを出す画面が `/staff/dashboard` と `/staff/[regionSlug]/[tournamentSlug]/entries` 以下に散っている一方で、

* レイアウト(`+layout.svelte`)は action を持てない
* `/staff/login` は既に `default` action を持っており、SvelteKit は `default` と名前付き action の併存を許さない

ため、どの既存ページにも置けない。`apps/frontend/src/routes/staff/logout/+page.server.ts` を `+page.svelte` の無いルートとして作り、`load` と action の双方が必ずリダイレクトする形にしている。参加者側は当初の想定どおり `/mypage?/logout` のまま。

##### Cookie 転送は `handleFetch` に一本化した

当初のスニペットは action の中で `forwardSetCookies()`(`src/lib/server/backend-cookies.ts`)を呼ぶ形だったが、`hooks.server.ts` の `handleFetch` が呼ぶ `forwardBackendCookies()` が同じ `Set-Cookie` を既に Cookie jar に載せており、重複していた。ただし両者は等価ではなく、`Secure` の扱いだけが違っていた。

| | `Secure` |
| --- | --- |
| `forwardBackendCookies()` | バックエンドの属性をそのまま写すので残る。平文 HTTP のフロントエンドではブラウザが Cookie を捨てる |
| `forwardSetCookies()` | フロントエンド自身のプロトコルから決め直すので落ちる |

そのため、`Secure` と `Domain` を再計算する側の扱いを `forwardBackendCookies()` に取り込んだうえで、`forwardSetCookies()` と `backend-cookies.ts` を削除した。`participant_session` と `staff_session` の経路が揃い、ループバック以外の平文アドレス(`vite dev --host`)でも両方通るようになっている。

##### バックエンドに届かなかった場合のフォールバックを足した

「ログアウトしたのにセッションが残る」は、エラーを画面に出すより避けたい失敗なので、応答が返らなかった場合はフロントエンド側で Cookie を落としてからリダイレクトする。あわせて `clearParticipantSession()` / `clearStaffSession()` が `secure` を `event.url` のプロトコルから決めるようにした(SvelteKit の既定はホスト名が厳密に `localhost` のときしか `Secure` を落とさず、`http://127.0.0.1:5173` などでは削除 Cookie 自体がブラウザに破棄される)。

#### テスト

* In `apps/backend/src/routes/participant-auth.test.ts`
  * `POST /logout clears the session cookie`
  * `POST /logout succeeds without a session`
  * `POST /logout deletes with the same attributes login set`(`Max-Age` と `Expires` を除いた属性集合をログイン時のものと比較する)
* In `apps/backend/src/routes/staff-auth.test.ts`
  * `POST /logout clears the staff session cookie`
* In `apps/frontend/src/routes/mypage/page.server.test.ts` / `apps/frontend/src/routes/staff/logout/page.server.test.ts`
  * ログアウト API を叩いてログイン画面へリダイレクトすること
  * バックエンドがエラーを返した場合と、応答自体が返らなかった場合のローカル失効
* In `apps/frontend/src/lib/server/backend-fetch.test.ts`
  * `Secure` をフロントエンドのプロトコルから決めること、`Domain` を落とすこと
* In `apps/frontend/src/lib/server/{participant,staff}-session.test.ts`
  * 平文 HTTP のとき削除 Cookie から `Secure` が落ちること
* In `apps/frontend/src/routes/{mypage,staff}/layout.svelte.test.ts`
  * ボタンの post 先と、未ログイン時に出さないこと
* In `apps/e2e/tests/entry-flow.spec.ts`
  * ログアウト後にマイページへ戻るとログイン画面へリダイレクトされること

#### 依存タスク

* Task 5-1, Task 6-1
