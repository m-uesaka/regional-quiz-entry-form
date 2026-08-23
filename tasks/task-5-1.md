[← tasks.md](../tasks.md) / Phase 5: 参加者向けマイページ

### Task 5-1: 参加者ログイン API とセッション管理

#### 実装・更新内容

* `POST /auth/participant/login` を実装し、email + password を検証して JWT(`hono/jwt`)を発行し、httpOnly Cookie に格納する。
* JWT の検証を行い `participantId` をコンテキストに詰める `requireParticipant()` ミドルウェアを実装する(Task 5-2 以降の `/mypage/*` ルートで使用)。
* `apps/frontend` 側で `hooks.server.ts` が Cookie の JWT を検証し、`locals.participant` に復元した participant 情報を詰める。

#### コードスニペット

`apps/backend/src/routes/participant-auth.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sign } from 'hono/jwt';
import { setCookie } from 'hono/cookie';
import type { Env } from '../types/env';
import { createDbClient } from '../lib/db';
import { verifyPassword } from '../lib/password';

const LoginSchema = z.object({ email: z.string().email(), password: z.string() });
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const participantAuthRoute = new Hono<Env>().post(
  '/login',
  zValidator('json', LoginSchema),
  async (c) => {
    const { email, password } = c.req.valid('json');
    const db = createDbClient(c.env);
    const { data: participant } = await db
      .from('participants')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (!participant || !(await verifyPassword(password, participant.password_hash))) {
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const token = await sign(
      { sub: participant.id, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
      c.env.SESSION_SECRET,
    );
    setCookie(c, 'participant_session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ ok: true });
  },
);
```

`apps/backend/src/middleware/participant-auth.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import type { Env } from '../types/env';

export function requireParticipant() {
  return createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, 'participant_session');
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      const payload = await verify(token, c.env.SESSION_SECRET);
      c.set('participantId', payload.sub as string);
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
}
```

#### テスト

* In `apps/backend/src/routes/participant-auth.test.ts`
  * `POST /login succeeds with correct credentials and sets a JWT cookie signed with SESSION_SECRET`
  * `POST /login returns 401 for a wrong password`
  * `POST /login returns 401 for a non-existent email`
* In `apps/backend/src/middleware/participant-auth.test.ts`
  * `requireParticipant sets participantId from a valid token`
  * `requireParticipant returns 401 when the cookie is missing`
  * `requireParticipant returns 401 for an expired or tampered token`

#### 依存タスク

* Task 1-1, Task 3-3(participant 作成ロジックとパスワードハッシュ形式の共有)
