[← tasks.md](../tasks.md) / Phase 3: エントリーフォーム機能(参加者向け)

### Task 3-3: エントリー登録 API ✅

#### 実装・更新内容

* `POST /tournaments/:tournamentId/entries` を実装する。処理内容:
  1. エントリー期間内かチェック(Task 3-6 のロジックを利用)
  2. `EntryInputSchema` でバリデーション
  3. Task 3-2 の `isRegulationSelectionAllowed` でレギュレーション優先期間チェック
  4. participant を email で検索、無ければ作成(その際 region の一致もチェックし、別地域で既に登録済みなら拒否)
  5. パスワードを Web Crypto(PBKDF2)でハッシュ化
  6. `entries` を `pending_verification` で作成
  7. Task 3-4 のメール確認トークンを発行してメール送信

#### コードスニペット

`apps/backend/src/lib/password.ts`

```typescript
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return `${Buffer.from(salt).toString('hex')}:${Buffer.from(bits).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return Buffer.from(bits).toString('hex') === hashHex;
}
```

`apps/backend/src/routes/entries.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { EntryInputSchema } from '@regional-quiz/shared';
import type { Env } from '../types/env';
import { createEntry } from '../lib/entries';

export const entriesRoute = new Hono<Env>().post(
  '/:tournamentId/entries',
  zValidator('json', EntryInputSchema),
  async (c) => {
    const result = await createEntry(c.env, c.req.param('tournamentId'), c.req.valid('json'));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.entry, 201);
  },
);
```

`apps/backend/src/lib/entries.ts`

```typescript
import type { EntryInput } from '@regional-quiz/shared';
import type { Bindings } from '../types/env';
import { createDbClient } from './db';
import { hashPassword } from './password';
import { isRegulationSelectionAllowed } from '@regional-quiz/shared';
import { sendVerificationEmail } from './entry-verification';

type CreateEntryResult =
  | { ok: true; entry: { id: string } }
  | { ok: false; status: 400 | 403 | 409; error: string };

export async function createEntry(
  env: Bindings,
  tournamentId: string,
  input: EntryInput,
): Promise<CreateEntryResult> {
  const db = createDbClient(env);

  const { data: tournament } = await db
    .from('tournaments')
    .select('*, regulations(*)')
    .eq('id', tournamentId)
    .single();
  if (!tournament) return { ok: false, status: 400, error: 'invalid tournament' };

  const now = new Date();
  if (now < new Date(tournament.entry_opens_at) || now > new Date(tournament.entry_closes_at)) {
    return { ok: false, status: 403, error: 'entry period closed' };
  }
  if (!isRegulationSelectionAllowed(tournament.regulations, input.regulationId, now)) {
    return { ok: false, status: 403, error: 'regulation not eligible in priority window' };
  }

  const { data: existingParticipant } = await db
    .from('participants')
    .select('*')
    .eq('email', input.email)
    .maybeSingle();
  if (existingParticipant && existingParticipant.region_id !== tournament.region_id) {
    return { ok: false, status: 409, error: 'already registered in another region' };
  }

  const participantId =
    existingParticipant?.id ??
    (
      await db
        .from('participants')
        .insert({
          email: input.email,
          region_id: tournament.region_id,
          password_hash: await hashPassword(input.password),
        })
        .select('id')
        .single()
    ).data?.id;

  const { data: entry, error } = await db
    .from('entries')
    .insert({
      participant_id: participantId,
      tournament_id: tournamentId,
      name: input.name,
      furigana: input.furigana,
      display_name: input.displayName,
      regulation_id: input.regulationId,
      free_text: input.freeText,
      custom_field_values: input.customFieldValues,
      status: 'pending_verification',
    })
    .select('id')
    .single();
  if (error) return { ok: false, status: 409, error: error.message };

  await sendVerificationEmail(env, entry.id, input.email);
  return { ok: true, entry };
}
```

#### テスト

* In `apps/backend/src/lib/entries.test.ts`
  * `createEntry rejects entry outside the entry period`
    * `entry_closes_at` が過去の tournament で呼び出し、`status: 403` を assert する
  * `createEntry rejects a non-priority regulation during the priority window`
    * 優先期間中のレギュレーション設定で、対象外の `regulationId` を渡し `403` を assert する
  * `createEntry rejects an email already registered in a different region`
    * 別地域で登録済みの participant と同じ email で呼び出し `409` を assert する
  * `createEntry creates a pending_verification entry and sends a verification email`
    * 正常系で `entries` に1件作成され、`sendVerificationEmail` が呼ばれることを assert する(mock)

#### 依存タスク

* Task 1-2, Task 3-2, Task 3-4(メール送信は関数呼び出しのみ先に決めておき、並行実装可)
