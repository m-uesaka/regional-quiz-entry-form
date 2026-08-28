[← tasks.md](../tasks.md) / Phase 10: 要件との差分の解消

### Task 10-3: ログアウト機能(参加者・スタッフ)

#### 実装・更新内容

* ログアウトがバックエンド・フロントエンドのどこにも存在しない(`logout` の文字列がコードベースに 1 件も無い)。参加者セッションは 7 日間(`routes/participant-auth.ts`)、スタッフは 12 時間(`routes/staff-auth.ts`)の stateless JWT を httpOnly Cookie に載せているだけなので、**利用者が自分でセッションを終わらせる手段が無い**。共用 PC や貸与端末からの離脱ができない。
* `POST /api/auth/participant/logout` と `POST /api/auth/staff/logout` を追加する。どちらも Cookie を削除するだけで、本体は同じ。認証は要求しない(未ログインでの呼び出しは 200 で無害に終わる方が、401 を返して画面側で分岐させるより素直)。
* Cookie の削除は `setCookie(..., '', {maxAge: 0})` ではなく `deleteCookie()` を使い、**発行時とまったく同じ属性(`path` / `secure` / `sameSite`)を指定する**。属性が食い違うと、ブラウザは別の Cookie とみなして元のものを消さない。
* フロントエンドはレイアウトにログアウトボタンを置く。`/api/*` をブラウザから直接叩くのは Task 9-5 が終わるまで本番で 404 になるため、SvelteKit の form action 経由(`/mypage?/logout` など)にして、action の中から `event.fetch` でバックエンドを呼び、`forwardSetCookies()` で削除 Cookie を持ち帰る。
* JWT は stateless なので、ログアウト後もトークン自体は有効期限まで署名として通る。「Cookie を消す」以上のことをするなら Task 11-3(スタッフセッションの失効)と同じ仕組みが要る。本タスクの範囲は Cookie の削除までとし、その旨をコメントに残す。

#### コードスニペット

`apps/backend/src/routes/participant-auth.ts`(追記)

```typescript
import {deleteCookie, setCookie} from 'hono/cookie';

export const participantAuthRoute = new Hono<Env>()
  .post('/login', /* 既存 */)
  .post('/logout', c => {
    // 発行時(setCookie)と同じ属性を渡す。path や sameSite が食い違うと
    // ブラウザは別 Cookie とみなし、元のセッションが残ってしまう。
    //
    // JWT 自体は stateless なので、既に盗まれたトークンはこの操作では
    // 止まらない(有効期限まで通る)。それを断ち切るには
    // participants.password_changed_at と同じ「サーバ側の世代」が要る。
    deleteCookie(c, PARTICIPANT_SESSION_COOKIE, {
      path: '/',
      secure: true,
      sameSite: 'Lax',
    });
    return c.json({ok: true});
  });
```

`apps/frontend/src/routes/mypage/+page.server.ts`(追記)

```typescript
export const actions = {
  logout: async ({fetch, cookies, url}) => {
    const res = await createApiClient(fetch).api.auth.participant.logout.$post();
    // バックエンドは別オリジンなので、削除用の Set-Cookie も自前で持ち帰る。
    forwardSetCookies(res, cookies, url);
    redirect(303, '/mypage/login');
  },
} satisfies Actions;
```

#### テスト

* In `apps/backend/src/routes/participant-auth.test.ts`
  * `POST /auth/participant/logout clears the session cookie`
  * `POST /auth/participant/logout succeeds without a session`
  * `POST /auth/participant/logout deletes with the same attributes login set`
* In `apps/backend/src/routes/staff-auth.test.ts`
  * `POST /auth/staff/logout clears the staff session cookie`
* In `apps/frontend/src/routes/mypage/page.server.test.ts`
  * `the logout action forwards the deletion cookie and redirects to the login page`
* In `apps/e2e/tests/entry-flow.spec.ts`
  * ログアウト後にマイページへ戻るとログイン画面へリダイレクトされること

#### 依存タスク

* Task 5-1, Task 6-1
