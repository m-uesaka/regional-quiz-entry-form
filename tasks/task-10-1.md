[← tasks.md](../tasks.md) / Phase 10: 要件との差分の解消

### Task 10-1: 地域ごとの「最強位・新人王 重複参加」可否の制御

#### 実装・更新内容

* `requirements.md` は「同じ地域の大会であれば，最強位と新人王の両方に参加することができる**ような地域も存在します**」と書いており、**両方に出られるかどうかは地域ごとの設定**である。現在の実装にはその区別が無く、同一地域なら誰でも両大会にエントリーできてしまう(`lib/entries.ts` の `createEntry()` は participant の `region_id` と大会の `region_id` の一致しか見ていない)。
* `regions` に `allows_dual_entry boolean not null default false` を追加し、false の地域では「同一地域内で 2 つ目の有効なエントリーを作ること」を拒否する。
* 既存データの移行は **default false**(=重複不可)にする。現状の挙動は「全地域で重複可」だが、これは仕様の欠落であって意図された既定ではない。運用開始前に地域ごとに明示的に true を立ててもらう方が、気付かないまま二重エントリーを受け付けるより安全。
* 判定は `createEntry()` の中、既存エントリーの確認と同じ箇所で行う。**`cancelled` は数えない**(キャンセル済みなら他方に出られるべき)。`pending_verification` は数える(メール確認前の枠取りで両方に出るのを防ぐ)。
* マイページの大会一覧と公開エントリーフォームにも、重複不可の地域では「もう一方の大会に既にエントリーしています」と出るようにする。

#### コードスニペット

`supabase/migrations/0016_regions_allows_dual_entry.sql`

```sql
-- 地域によっては最強位と新人王の両方に参加できる(requirements.md)。
-- 既定は false: 現在の「どの地域でも両方に出られる」挙動は仕様の欠落なので、
-- 移行時に全地域を許可側へ倒すのではなく、地域ごとに明示させる。
alter table regions
  add column allows_dual_entry boolean not null default false;
```

`apps/backend/src/lib/entries.ts`(`createEntry()` に追記)

```typescript
// 大会の取得時に地域の設定も一緒に引く(既存の select に追記)。
//   .select('id, region_id, entry_opens_at, entry_closes_at, ' +
//           'regions(allows_dual_entry), ' +
//           'regulations(id, priority_starts_at, priority_ends_at)')

// 同一地域の別大会に有効なエントリーがあるかを見る。cancelled は数えない
// (キャンセルすれば別大会に移れる)が、pending_verification は数える
// (メール確認前の枠取りで両方を押さえるのを防ぐ)。
if (!tournament.regions.allows_dual_entry) {
  const {count, error: dualError} = await db
    .from('entries')
    .select('id, tournaments!inner(region_id)', {count: 'exact', head: true})
    .eq('participant_id', participantId)
    .eq('tournaments.region_id', tournament.region_id)
    .neq('tournament_id', tournamentId)
    .in('status', ['pending_verification', 'confirmed', 'waitlisted']);
  if (dualError) {
    return {ok: false, status: 500, error: dualError.message};
  }
  if ((count ?? 0) > 0) {
    return {ok: false, status: 409, error: 'already entered another tournament in this region'};
  }
}
```

`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/entry/+page.server.ts`(追記)

```typescript
const ENTRY_ERROR_MESSAGES: Record<string, string> = {
  /* 既存 */
  'already entered another tournament in this region':
    'この地域では、最強位と新人王のどちらか一方にのみエントリーできます',
};
```

#### テスト

* In `apps/backend/src/lib/entries.test.ts`
  * `createEntry refuses a second tournament in a region that disallows dual entry`
  * `createEntry allows a second tournament when the region allows dual entry`
  * `createEntry allows a second tournament when the first entry was cancelled`
  * `createEntry counts a pending_verification entry as occupying the region`
  * `createEntry still allows re-entering the same tournament after cancelling`
* In `apps/backend/src/lib/db-schema.test.ts`
  * `regions.allows_dual_entry defaults to false`
* In `apps/e2e/tests/entry-flow.spec.ts`
  * 重複不可の地域で 2 つ目の大会にエントリーしようとすると、フォームに日本語のエラーが出ること

#### 依存タスク

* Task 3-3, Task 9-2
