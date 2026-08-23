[← tasks.md](../tasks.md) / Phase 5: 参加者向けマイページ

### Task 5-5: パスワード再設定機能

#### 実装・更新内容

* `POST /auth/participant/password-reset/request`(email 宛にリセットリンク送信)と `POST /auth/participant/password-reset/confirm`(トークン + 新パスワード)を実装する。
* `password_reset_tokens` を使い、Task 3-4 のメール確認トークンと同様に有効期限・使い捨てチェックを行う。

#### コードスニペット

`apps/backend/src/routes/password-reset.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types/env';
import { requestPasswordReset, confirmPasswordReset } from '../lib/password-reset';

export const passwordResetRoute = new Hono<Env>()
  .post('/request', zValidator('json', z.object({ email: z.string().email() })), async (c) => {
    await requestPasswordReset(c.env, c.req.valid('json').email);
    return c.json({ ok: true }); // メール存在有無に関わらず同じレスポンスにし、列挙攻撃を防ぐ
  })
  .post(
    '/confirm',
    zValidator('json', z.object({ token: z.string(), newPassword: z.string().min(8) })),
    async (c) => {
      const result = await confirmPasswordReset(c.env, c.req.valid('json'));
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );
```

`apps/backend/src/lib/password-reset.ts`

```typescript
export async function confirmPasswordReset(
  env: Bindings,
  input: { token: string; newPassword: string },
): Promise<{ ok: boolean; error?: string }> {
  const db = createDbClient(env);
  const { data: tokenRow } = await db
    .from('password_reset_tokens')
    .select('*')
    .eq('token', input.token)
    .maybeSingle();
  if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
    return { ok: false, error: 'invalid or expired token' };
  }
  await db
    .from('participants')
    .update({ password_hash: await hashPassword(input.newPassword) })
    .eq('id', tokenRow.participant_id);
  await db.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('token', input.token);
  return { ok: true };
}
```

#### テスト

* In `apps/backend/src/lib/password-reset.test.ts`
  * `requestPasswordReset always returns ok regardless of whether the email exists`
  * `confirmPasswordReset updates the password with a valid token`
  * `confirmPasswordReset rejects a reused token`(2回目の呼び出しでエラー)
  * `confirmPasswordReset rejects an expired token`

#### 依存タスク

* Task 0-6, Task 5-1
