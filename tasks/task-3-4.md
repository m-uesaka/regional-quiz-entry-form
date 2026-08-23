[← tasks.md](../tasks.md) / Phase 3: エントリーフォーム機能(参加者向け)

### Task 3-4: メールアドレス確認フロー ✅

#### 実装・更新内容

* エントリー作成時に確認メールを送るユーティリティ `sendVerificationEmail` と、確認リンククリック時に `entries.status` を `confirmed`(または `waitlisted`、Task 3-5 参照)に更新する `GET /entries/verify` エンドポイントを実装する。
* トークンは `email_verification_tokens` に保存し、有効期限・使用済みチェックを行う。

#### コードスニペット

`apps/backend/src/lib/entry-verification.ts`

```typescript
import type { Bindings } from '../types/env';
import { createDbClient } from './db';
import { ResendMailSender } from './mailer';

export async function sendVerificationEmail(
  env: Bindings,
  entryId: string,
  email: string,
): Promise<void> {
  const db = createDbClient(env);
  const token = crypto.randomUUID();
  await db.from('email_verification_tokens').insert({
    entry_id: entryId,
    token,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  const mailer = new ResendMailSender(env.MAIL_API_KEY);
  await mailer.send({
    to: email,
    subject: 'エントリー確認メール',
    html: `<a href="https://entry.regionalquiz.example/verify?token=${token}">こちらをクリックしてエントリーを確定してください</a>`,
  });
}
```

`apps/backend/src/routes/entry-verification.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types/env';
import { confirmEntryByToken } from '../lib/entry-confirmation';

export const entryVerificationRoute = new Hono<Env>().get(
  '/verify',
  zValidator('query', z.object({ token: z.string() })),
  async (c) => {
    const result = await confirmEntryByToken(c.env, c.req.valid('query').token);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ status: result.status });
  },
);
```

#### テスト

* In `apps/backend/src/lib/entry-confirmation.test.ts`
  * `confirmEntryByToken confirms a valid, unused token`
    * 有効なトークンで呼び出し、`entries.status` が `confirmed`(定員に空きがある場合)に更新されることを assert する
  * `confirmEntryByToken rejects an expired token`
    * `expires_at` が過去のトークンで呼び出し、エラーを assert する
  * `confirmEntryByToken rejects an already-used token`
    * `used_at` が設定済みのトークンで呼び出し、エラーを assert する

#### 依存タスク

* Task 0-6(メール送信サービス), Task 3-3, Task 3-5(定員判定と連動するため)
