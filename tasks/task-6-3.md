[← tasks.md](../tasks.md) / Phase 6: 地域スタッフ向け管理ページ

### Task 6-3: 参加者へのメール送信機能

#### 実装・更新内容

* 地域スタッフが大会内の(全員 or ステータス絞り込みの)参加者へ一斉メールを送信できる `POST /staff/tournaments/:tournamentId/mail` を実装する。
* Task 0-6 の `MailSender` インターフェースを使い、送信件数が多い場合はバッチ送信(レート制御)する。

#### コードスニペット

`apps/backend/src/routes/staff-mail.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types/env';
import { requireStaffForTournament } from '../middleware/staff-auth';
import { createDbClient } from '../lib/db';
import { ResendMailSender } from '../lib/mailer';
import { EntryStatusSchema } from '@regional-quiz/shared';

const SendMailSchema = z.object({
  subject: z.string(),
  body: z.string(),
  statusFilter: EntryStatusSchema.optional(),
});

export const staffMailRoute = new Hono<Env>()
  .use('/:tournamentId/*', requireStaffForTournament())
  .post('/:tournamentId/mail', zValidator('json', SendMailSchema), async (c) => {
    const { subject, body, statusFilter } = c.req.valid('json');
    const db = createDbClient(c.env);
    let query = db
      .from('entries')
      .select('participants(email)')
      .eq('tournament_id', c.req.param('tournamentId'));
    if (statusFilter) query = query.eq('status', statusFilter);
    const { data: entries } = await query;

    const mailer = new ResendMailSender(c.env.MAIL_API_KEY);
    for (const entry of entries ?? []) {
      await mailer.send({ to: entry.participants.email, subject, html: body });
    }
    return c.json({ sent: entries?.length ?? 0 });
  });
```

#### テスト

* In `apps/backend/src/routes/staff-mail.test.ts`
  * `POST /staff/.../mail sends to all entries when no statusFilter is given`
  * `POST /staff/.../mail sends only to entries matching statusFilter`
  * `POST /staff/.../mail returns 403 for staff outside their scope`

#### 依存タスク

* Task 0-6, Task 6-1, Task 6-2
