[← tasks.md](../tasks.md) / Phase 3: エントリーフォーム機能(参加者向け)

### Task 3-5: 定員管理とキャンセル待ちロジック

#### 実装・更新内容

* メール確認完了時、大会の `capacity` と現在の `confirmed` 件数を比較し、定員内なら `confirmed`、超過なら `waitlisted`(+ `waitlist_position` 採番)にする処理を `confirmEntryByToken` 内に実装する。
* エントリーキャンセル時(Task 5-4)、キャンセルされたのが `confirmed` なら、`waitlisted` の中で最も `waitlist_position` が小さいものを `confirmed` に繰り上げ、通知メールを送る処理 `promoteNextWaitlistedEntry` を実装する。

#### コードスニペット

`apps/backend/src/lib/entry-confirmation.ts`

```typescript
import type { Bindings } from '../types/env';
import { createDbClient } from './db';

type ConfirmResult =
  | { ok: true; status: 'confirmed' | 'waitlisted' }
  | { ok: false; error: string };

export async function confirmEntryByToken(env: Bindings, token: string): Promise<ConfirmResult> {
  const db = createDbClient(env);
  const { data: tokenRow } = await db
    .from('email_verification_tokens')
    .select('*, entries(*, tournaments(capacity))')
    .eq('token', token)
    .maybeSingle();

  if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at) < new Date()) {
    return { ok: false, error: 'invalid or expired token' };
  }

  const capacity = tokenRow.entries.tournaments.capacity;
  const { count: confirmedCount } = await db
    .from('entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tokenRow.entries.tournament_id)
    .eq('status', 'confirmed');

  const status = capacity && (confirmedCount ?? 0) >= capacity ? 'waitlisted' : 'confirmed';

  await db
    .from('entries')
    .update({
      status,
      email_verified_at: new Date().toISOString(),
      waitlist_position: status === 'waitlisted' ? (confirmedCount ?? 0) + 1 : null,
    })
    .eq('id', tokenRow.entry_id);

  await db.from('email_verification_tokens').update({ used_at: new Date().toISOString() }).eq('token', token);

  return { ok: true, status };
}
```

`apps/backend/src/lib/waitlist.ts`

```typescript
import type { Bindings } from '../types/env';
import { createDbClient } from './db';
import { ResendMailSender } from './mailer';

export async function promoteNextWaitlistedEntry(env: Bindings, tournamentId: string): Promise<void> {
  const db = createDbClient(env);
  const { data: next } = await db
    .from('entries')
    .select('*, participants(email)')
    .eq('tournament_id', tournamentId)
    .eq('status', 'waitlisted')
    .order('waitlist_position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return;

  await db.from('entries').update({ status: 'confirmed', waitlist_position: null }).eq('id', next.id);

  const mailer = new ResendMailSender(env.MAIL_API_KEY);
  await mailer.send({
    to: next.participants.email,
    subject: 'キャンセル待ちからの繰り上げについて',
    html: '<p>キャンセルが発生したため、あなたのエントリーが確定しました。</p>',
  });
}
```

#### テスト

* In `apps/backend/src/lib/entry-confirmation.test.ts`(追加ケース)
  * `confirmEntryByToken waitlists an entry when capacity is full`
    * capacity=1 で既に confirmed が1件ある状態で確認し、`status: 'waitlisted'` と `waitlist_position: 1` を assert する
* In `apps/backend/src/lib/waitlist.test.ts`
  * `promoteNextWaitlistedEntry promotes the entry with the smallest waitlist_position`
    * waitlist_position が 1, 2 の2件がある状態で呼び出し、position=1 の entry が `confirmed` になることを assert する
  * `promoteNextWaitlistedEntry does nothing when there is no waitlisted entry`
    * waitlist が空の状態で呼び出し、例外なく終了することを assert する

#### 依存タスク

* Task 3-4
