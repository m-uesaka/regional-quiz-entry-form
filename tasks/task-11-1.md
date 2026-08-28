[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-1: レート制限と Turnstile(ログイン・エントリー・再設定要求)

#### 実装・更新内容

* レート制限・ロックアウト・CAPTCHA が**どこにも無い**。無防備なのは以下で、いずれも無認証で叩ける:
  * `POST /api/auth/staff/login` / `POST /api/auth/participant/login` — 資格情報の総当たり。
  * `POST /api/tournaments/:tournamentId/entries` — 任意アドレスへの確認メール送信。
  * `POST /api/auth/participant/password-reset/request` — 任意アドレスへの再設定メール送信。
* 二次被害が 2 つある。(a) メール送信を伴う 2 つは**メール爆撃**に使え、Resend のクォータ枯渇と送信ドメインのレピュテーション毀損に直結する。(b) パスワード検証は PBKDF2 10 万回(`lib/password.ts`)なので、ログインを叩き続けるだけで **Worker の CPU を枯渇させる増幅攻撃**になる。
* 対策は 2 層:
  1. **Cloudflare Workers の Rate Limiting binding** を全対象エンドポイントに掛ける。キーは「IP + エンドポイント」を基本にし、資格情報系は「メールアドレス」でも別途絞る(1 つの IP から多数のアカウントを試す攻撃と、多数の IP から 1 アカウントを試す攻撃は別の鍵で止める必要がある)。
  2. **Turnstile** をエントリーフォームとパスワード再設定要求フォームに入れる。この 2 つは「善意の利用者が 1 回だけ送る」性質なので、CAPTCHA の摩擦が最も小さく、かつメール爆撃の抑止として最も効く。
* レート制限に掛かったときは **429 と `Retry-After`** を返す。フロント側は「しばらく待ってから再試行してください」を表示する。**アカウントロックアウトは実装しない**: メールアドレスさえ分かれば他人のアカウントを締め出せる DoS になるため。
* Turnstile の検証は失敗時に**必ず落とす**(fail closed)。検証 API に到達できないときも通してしまうと、Cloudflare 側の障害がそのまま素通しになる。

#### コードスニペット

`apps/backend/wrangler.toml`

```toml
# namespace_id は本番/staging で共有しない。period は 10 か 60 のみ。
[[ratelimits]]
name = "LOGIN_RATE_LIMITER"
namespace_id = "1001"
simple = {limit = 10, period = 60}

[[ratelimits]]
name = "MAIL_TRIGGER_RATE_LIMITER"
namespace_id = "1002"
simple = {limit = 3, period = 60}
```

`apps/backend/src/middleware/rate-limit.ts`(新規)

```typescript
/**
 * 指定の rate limiter で `keyOf(c)` を絞る。超過は 429 + Retry-After。
 *
 * ロックアウト(N 回失敗でアカウントを止める)は採らない。メールアドレスさえ
 * 分かれば任意の参加者を締め出せる DoS になるため、あくまで「単位時間あたりの
 * 試行回数」だけを制限する。
 */
export function rateLimit(
  binding: (env: Bindings) => RateLimiter,
  keyOf: (c: Context<Env>) => string,
  retryAfterSeconds: number,
) {
  return createMiddleware<Env>(async (c, next) => {
    const {success} = await binding(c.env).limit({key: keyOf(c)});
    if (!success) {
      return c.json({error: 'too many requests'}, 429, {
        'Retry-After': String(retryAfterSeconds),
      });
    }
    await next();
  });
}

/** CF-Connecting-IP は Cloudflare が付け直すので詐称できない。 */
export const clientIp = (c: Context<Env>): string =>
  c.req.header('cf-connecting-ip') ?? 'unknown';
```

`apps/backend/src/routes/participant-auth.ts`(適用例)

```typescript
export const participantAuthRoute = new Hono<Env>().post(
  '/login',
  // IP と メールアドレスの両方で絞る。1 IP から多数のアカウントを試す攻撃と、
  // 多数の IP から 1 アカウントを試す攻撃は、別の鍵でしか止まらない。
  rateLimit(env => env.LOGIN_RATE_LIMITER, c => `ip:${clientIp(c)}`, 60),
  zValidator('json', ParticipantLoginInputSchema),
  rateLimit(env => env.LOGIN_RATE_LIMITER, c => `email:${c.req.valid('json').email}`, 60),
  async c => {/* 既存 */},
);
```

`apps/backend/src/lib/turnstile.ts`(新規)

```typescript
/**
 * Turnstile のトークンを検証する。検証 API に届かない場合も false を返す
 * (fail closed): Cloudflare 側の一時障害でメール爆撃の口が開くより、
 * 送信を止めて再試行してもらう方がよい。
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({secret, response: token, remoteip: ip}),
      },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as {success?: boolean};
    return body.success === true;
  } catch {
    return false;
  }
}
```

#### テスト

* In `apps/backend/src/middleware/rate-limit.test.ts`
  * `rateLimit answers 429 with Retry-After once the limiter refuses`
  * `rateLimit keys IP and email separately`
  * `clientIp falls back when CF-Connecting-IP is absent`
* In `apps/backend/src/lib/turnstile.test.ts`
  * `verifyTurnstile returns false when the siteverify call fails`
  * `verifyTurnstile returns false on a non-2xx response`
  * `verifyTurnstile returns true only for success: true`
* In `apps/backend/src/routes/participant-auth.test.ts` / `staff-auth.test.ts` / `entries.test.ts` / `password-reset.test.ts`
  * 各エンドポイントで `returns 429 when the rate limiter refuses`
  * エントリーと再設定要求で `returns 400 when the Turnstile token is missing or invalid`

#### 依存タスク

* Task 3-3, Task 5-1, Task 5-5, Task 6-1
