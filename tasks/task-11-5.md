[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-5: CSRF 対策の明示化とセキュリティヘッダ

#### 実装・更新内容

* **CSRF**: バックエンドには CSRF トークンも Origin 検証も無い。現状で成立しているのは、(a) セッション Cookie が `SameSite=Lax` であること、(b) CORS ヘッダを一切返していないこと、の 2 つの偶発的な条件によるもの。`hono/cors` を足した瞬間、あるいは何かの都合で Cookie が `SameSite=None` になった瞬間に、警告も無く無防備になる。**依存している前提を暗黙にしない**ため、状態変更ルートに明示的な Origin 検証を置く。
  * `hono/csrf` の `csrf({origin})` を、`GET` 以外を受けるルート全体に適用する。許可オリジンは `FRONTEND_URL` から取る(既に binding にある)。
  * SvelteKit 側の form actions は同種の検証を標準で行うが、バックエンドは別 Worker なので独立して必要。
* **セキュリティヘッダ**: 両アプリとも `Cache-Control` を含めて何も設定していない(`setHeaders` / `Cache-Control` の使用箇所が 0)。
  * バックエンド: `hono/secure-headers` の `secureHeaders()` を全体に適用。
  * フロントエンド: `hooks.server.ts` の `resolve()` の戻りに CSP・`Referrer-Policy`・`X-Content-Type-Options` を付ける。SvelteKit は `svelte.config.js` の `kit.csp` でハッシュ/nonce ベースの CSP を生成できるので、まずそちらを使う。
  * **参加者の個人情報を含む応答に `Cache-Control: private, no-store` を付ける**。マイページとスタッフ画面が対象。現状は無指定なので、中間キャッシュや `bfcache` の挙動が環境任せになっている。
* **トークンの URL 露出**: メール確認・パスワード再設定のトークンがクエリ文字列に乗る(`/verify?token=...`、`/password-reset?token=...`)。ワンタイムかつ短命なので影響は限定的だが、`Referrer-Policy: no-referrer` を付けて、そのページから外部リンクを踏んだときに Referer で漏れないようにする。加えて、`/password-reset` ページはトークンを読んだ直後に `history.replaceState` で URL から消す。

#### コードスニペット

`apps/backend/src/index.ts`(改修)

```typescript
import {csrf} from 'hono/csrf';
import {secureHeaders} from 'hono/secure-headers';

const app = new Hono<Env>().basePath('/api');

app.use('*', secureHeaders());
// SameSite=Lax と「CORS ヘッダを返していないこと」に暗黙に依存している状態を
// やめる。ここを明示しておけば、将来 cors() を足しても素通しにはならない。
app.use('*', csrf({origin: c => [c.env.FRONTEND_URL]}));
```

`apps/frontend/src/hooks.server.ts`(改修)

```typescript
export const handle: Handle = async ({event, resolve}) => {
  /* 既存のセッション読み取り */
  const response = await resolve(event);

  // トークンはクエリ文字列に乗るので、そのページから外部へ遷移したときに
  // Referer で持ち出されないようにする。
  response.headers.set('referrer-policy', 'no-referrer');
  response.headers.set('x-content-type-options', 'nosniff');

  // 個人情報を含む画面は中間キャッシュにも bfcache にも残さない。
  if (isPrivatePath(event.url.pathname)) {
    response.headers.set('cache-control', 'private, no-store');
  }
  return response;
};

/** マイページとスタッフ/管理画面。公開エントリーリストは含めない。 */
function isPrivatePath(pathname: string): boolean {
  return ['/mypage', '/staff', '/admin'].some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
```

`apps/frontend/svelte.config.js`(改修)

```javascript
  kit: {
    csp: {
      // インラインスクリプトはハッシュで許可する。外部への接続は自分自身と
      // /api/* のみ(バックエンドは同一オリジンに route される)。
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'frame-ancestors': ['none'],
        'form-action': ['self'],
      },
    },
  },
```

#### テスト

* In `apps/backend/src/index.test.ts`
  * `a state-changing request from a foreign origin is refused`
  * `a request from FRONTEND_URL is allowed`
  * `a GET is not subject to the origin check`
  * `every response carries the secure headers`
* In `apps/frontend/src/hooks.server.test.ts`
  * `a mypage response is marked private, no-store`
  * `a public entry list response is not marked no-store`
  * `every response carries Referrer-Policy: no-referrer`
* In `apps/frontend/src/routes/password-reset/page.svelte.test.ts`
  * `the token is removed from the URL after it is read`

#### 依存タスク

* Task 3-4, Task 5-5, Task 6-1
