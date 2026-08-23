[← tasks.md](../tasks.md) / Phase 5: 参加者向けマイページ

### Task 5-4: エントリーキャンセルと再エントリー

#### 実装・更新内容

* `DELETE /mypage/entries/:entryId` を実装し、`status` を `cancelled` に更新する。もとの `status` が `confirmed` だった場合は Task 3-5 の `promoteNextWaitlistedEntry` を呼ぶ。
* キャンセル後、同じ email/password で再エントリーできるよう、Task 3-3 の `createEntry` は「同一 participant・tournament で `cancelled` の entry が既にある場合は新規行ではなく上書き(status を `pending_verification` に戻す)」処理を追加する。

#### コードスニペット

`apps/backend/src/lib/entries.ts`(`createEntry` 内、insert 部分を更新)

```typescript
// 既存の cancelled entry を探し、あれば upsert 的に更新する
const { data: existingEntry } = await db
  .from('entries')
  .select('id, status')
  .eq('participant_id', participantId)
  .eq('tournament_id', tournamentId)
  .maybeSingle();

if (existingEntry && existingEntry.status !== 'cancelled') {
  return { ok: false, status: 409, error: 'already entered' };
}

const upsertPayload = {
  /* ...Task 3-3 の insert と同じフィールド */
};

const { data: entry, error } = existingEntry
  ? await db.from('entries').update(upsertPayload).eq('id', existingEntry.id).select('id').single()
  : await db.from('entries').insert(upsertPayload).select('id').single();
```

`apps/backend/src/lib/entries.ts`(キャンセル処理)

```typescript
export async function cancelOwnEntry(
  env: Bindings,
  participantId: string,
  entryId: string,
): Promise<{ ok: boolean }> {
  const db = createDbClient(env);
  const { data: entry } = await db
    .from('entries')
    .select('status, tournament_id')
    .eq('id', entryId)
    .eq('participant_id', participantId)
    .single();

  await db
    .from('entries')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', entryId);

  if (entry.status === 'confirmed') {
    await promoteNextWaitlistedEntry(env, entry.tournament_id);
  }
  return { ok: true };
}
```

#### テスト

* In `apps/backend/src/lib/entries.test.ts`(追加ケース)
  * `cancelOwnEntry cancels a confirmed entry and promotes the next waitlisted entry`
  * `cancelOwnEntry cancels a waitlisted entry without promoting anyone`
  * `createEntry after cancellation reuses the same entry row with pending_verification status`
    * キャンセル済み entry がある状態で同じ email/password で再度 `createEntry` を呼び、新規行が増えず `status: pending_verification` に戻ることを assert する

#### 依存タスク

* Task 3-3, Task 3-5, Task 5-2
