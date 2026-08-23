[← tasks.md](../tasks.md) / Phase 5: 参加者向けマイページ

### Task 5-3: エントリー内容編集

#### 実装・更新内容

* `PATCH /mypage/entries/:entryId` を実装し、エントリー期間内かつ本人のエントリーである場合のみ内容(name, furigana, displayName, freeText, customFieldValues 等。email/password は対象外)を更新できるようにする。
* 編集画面は Task 3-1 の `DynamicFormField` を再利用する。

#### コードスニペット

`apps/backend/src/routes/mypage.ts`(追記)

```typescript
import { EntryInputSchema } from '@regional-quiz/shared';
import { isWithinEntryPeriod } from '@regional-quiz/shared';

const EditableEntrySchema = EntryInputSchema.innerType().pick({
  name: true,
  furigana: true,
  displayName: true,
  freeText: true,
  customFieldValues: true,
});

// mypageRoute に追加:
// .patch('/entries/:entryId', zValidator('json', EditableEntrySchema), async (c) => { ... })
```

```typescript
export async function updateOwnEntry(
  env: Bindings,
  participantId: string,
  entryId: string,
  patch: Partial<EntryInput>,
): Promise<{ ok: boolean; error?: string }> {
  const db = createDbClient(env);
  const { data: entry } = await db
    .from('entries')
    .select('*, tournaments(entry_opens_at, entry_closes_at)')
    .eq('id', entryId)
    .eq('participant_id', participantId)
    .maybeSingle();
  if (!entry) return { ok: false, error: 'not found' };
  if (!isWithinEntryPeriod(entry.tournaments.entry_opens_at, entry.tournaments.entry_closes_at)) {
    return { ok: false, error: 'entry period closed' };
  }
  await db.from('entries').update(patch).eq('id', entryId);
  return { ok: true };
}
```

#### テスト

* In `apps/backend/src/lib/entries.test.ts`(追加ケース)
  * `updateOwnEntry updates the entry within the entry period`
  * `updateOwnEntry rejects updates outside the entry period`
  * `updateOwnEntry rejects updating another participant's entry`

#### 依存タスク

* Task 3-1, Task 3-6, Task 5-2
