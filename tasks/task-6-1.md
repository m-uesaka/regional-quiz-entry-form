[← tasks.md](../tasks.md) / Phase 6: 地域スタッフ向け管理ページ

### Task 6-1: スタッフ認証・権限管理

#### 実装・更新内容

* `staff_accounts` を使ったログイン API(`POST /auth/staff/login`)を実装する。ログイン成功時、`role` / `region_id` / `tournament_type` を claims に含めた JWT を発行し、httpOnly Cookie に格納する(参加者用と異なり、認可判定に必要な情報を claims に載せることでリクエストごとの `staff_accounts` 参照を省略する)。
* `role: 'regional'` は自分の `region_id` + `tournament_type` に一致する大会のみアクセス可能、`role: 'general'` は全大会にアクセス可能とする認可ミドルウェア `requireStaffForTournament()` / `requireGeneralStaff()` を、JWT の検証・claims 読み取りで実装する。

#### コードスニペット

`apps/backend/src/routes/staff-auth.ts`

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
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export const staffAuthRoute = new Hono<Env>().post(
  '/login',
  zValidator('json', LoginSchema),
  async (c) => {
    const { email, password } = c.req.valid('json');
    const db = createDbClient(c.env);
    const { data: staff } = await db
      .from('staff_accounts')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (!staff || !(await verifyPassword(password, staff.password_hash))) {
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const token = await sign(
      {
        sub: staff.id,
        role: staff.role,
        regionId: staff.region_id,
        tournamentType: staff.tournament_type,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      },
      c.env.SESSION_SECRET,
    );
    setCookie(c, 'staff_session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ ok: true, role: staff.role });
  },
);
```

`apps/backend/src/middleware/staff-auth.ts`

```typescript
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import type { Env } from '../types/env';
import { createDbClient } from '../lib/db';

interface StaffClaims {
  sub: string;
  role: 'regional' | 'general';
  regionId: string | null;
  tournamentType: 'saikyoi' | 'shinjinou' | null;
}

async function readStaffClaims(
  token: string | undefined,
  secret: string,
): Promise<StaffClaims | null> {
  if (!token) return null;
  try {
    return (await verify(token, secret)) as unknown as StaffClaims;
  } catch {
    return null;
  }
}

export function requireGeneralStaff() {
  return createMiddleware<Env>(async (c, next) => {
    const staff = await readStaffClaims(getCookie(c, 'staff_session'), c.env.SESSION_SECRET);
    if (staff?.role !== 'general') return c.json({ error: 'forbidden' }, 403);
    c.set('staff', staff);
    await next();
  });
}

export function requireStaffForTournament() {
  return createMiddleware<Env>(async (c, next) => {
    const staff = await readStaffClaims(getCookie(c, 'staff_session'), c.env.SESSION_SECRET);
    if (!staff) return c.json({ error: 'unauthorized' }, 401);

    const db = createDbClient(c.env);
    const { data: tournament } = await db
      .from('tournaments')
      .select('region_id, type')
      .eq('id', c.req.param('tournamentId'))
      .single();

    const allowed =
      staff.role === 'general' ||
      (staff.role === 'regional' &&
        staff.regionId === tournament?.region_id &&
        staff.tournamentType === tournament?.type);
    if (!allowed) return c.json({ error: 'forbidden' }, 403);

    c.set('staff', staff);
    await next();
  });
}
```

#### テスト

* In `apps/backend/src/routes/staff-auth.test.ts`
  * `POST /login issues a JWT cookie whose claims include role, regionId, and tournamentType`
  * `POST /login returns 401 for a wrong password`
* In `apps/backend/src/middleware/staff-auth.test.ts`
  * `requireStaffForTournament allows regional staff for their own region and type`
  * `requireStaffForTournament rejects regional staff for a different region`
  * `requireStaffForTournament rejects regional staff for a different tournament type in the same region`
  * `requireStaffForTournament allows general staff for any tournament`
  * `requireStaffForTournament returns 401 for an expired or tampered token`
  * `requireGeneralStaff rejects a valid token whose role is "regional"`

#### 依存タスク

* Task 1-1
