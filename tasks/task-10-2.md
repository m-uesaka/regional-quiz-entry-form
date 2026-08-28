[← tasks.md](../tasks.md) / Phase 10: 要件との差分の解消

### Task 10-2: レギュレーションの複数選択対応

#### 実装・更新内容

* `requirements.md` は「レギュレーションは複数の条件があり、**どれか一つを最低限でも**満たしている必要があります」と書いている。「最低限でも一つ」= 複数該当し得るという読みだが、現在の実装は `entries.regulation_id` の単一 FK で、UI もラジオ相当の単一選択になっている。
* **着手前に統括スタッフへ確認すること**。「複数チェックできる」ことに運用上の意味があるのか(例: 優先期間の判定や当日の資格確認に効くのか)、単一選択で足りるのかは要件の読み方の問題で、実装コストは前者が明確に大きい。単一選択で確定するなら本タスクは閉じ、`requirements.md` 側に注記を入れて終わりにする。
* 複数選択にする場合の設計:
  * 中間テーブル `entry_regulations (entry_id, regulation_id, tournament_id)` を作り、既存の複合 FK `(regulation_id, tournament_id) references regulations (id, tournament_id)` をこちらに移す。**「あるエントリーが別大会のレギュレーションを参照できない」という DB レベルの保証を落とさない**のが移行のキモ(`docs/database-schema.md` 参照)。
  * `entries.regulation_id` は移行後に落とす。移行マイグレーションで既存行を 1 件ずつ中間テーブルへ写してから drop する。
  * 優先期間ロジック `isRegulationSelectionAllowed()` は「選択された集合のうち少なくとも 1 つが、現在アクティブな優先レギュレーションであること」に変える。
  * `Entry.regulationLabel`(単数)を `regulationLabels`(配列)にする。スタッフ一覧・詳細・CSV・マイページの表示が連動する。

#### コードスニペット

`supabase/migrations/0017_entry_regulations.sql`

```sql
create table entry_regulations (
  entry_id uuid not null references entries (id) on delete cascade,
  regulation_id uuid not null,
  -- 複合 FK を維持するために tournament_id を冗長に持つ。これが無いと
  -- 「別大会のレギュレーションを選んだエントリー」を DB が止められない。
  tournament_id uuid not null,
  primary key (entry_id, regulation_id),
  foreign key (regulation_id, tournament_id) references regulations (id, tournament_id)
);
create index entry_regulations_regulation_id_idx on entry_regulations (regulation_id);
alter table entry_regulations enable row level security;

-- 既存の単一選択を移送してから、旧列を落とす。
insert into entry_regulations (entry_id, regulation_id, tournament_id)
select e.id, e.regulation_id, e.tournament_id from entries e;

alter table entries drop constraint entries_regulation_id_tournament_id_fkey;
alter table entries drop column regulation_id;
```

`packages/shared/src/logic/regulation-eligibility.ts`(改修)

```typescript
/**
 * 選択されたレギュレーション集合がいま受け付け可能かを返す。
 * 規則は単一選択のときと同じで、判定対象が集合になっただけ:
 * アクティブな優先期間が 1 つでもあれば、その優先レギュレーションのうち
 * 少なくとも 1 つを選んでいなければならない。1 つも無ければ何を選んでもよい。
 */
export function isRegulationSelectionAllowed(
  regulations: RegulationWindow[],
  selectedIds: readonly string[],
  now: Date = new Date(),
): boolean {
  if (selectedIds.length === 0) return false;
  const active = regulations.filter(r => isPriorityWindowActive(r, now));
  if (active.length === 0) return true;
  return selectedIds.some(id => active.some(r => r.id === id));
}
```

#### テスト

* In `packages/shared/src/logic/regulation-eligibility.test.ts`
  * `isRegulationSelectionAllowed rejects an empty selection`
  * `isRegulationSelectionAllowed accepts any selection when no priority window is active`
  * `isRegulationSelectionAllowed accepts a selection containing one active priority regulation`
  * `isRegulationSelectionAllowed rejects a selection of only non-priority regulations during a window`
* In `apps/backend/src/lib/entries.test.ts`
  * `createEntry stores every selected regulation`
  * `createEntry refuses a regulation belonging to another tournament`
* In `apps/backend/src/lib/entries-csv.test.ts`
  * `buildEntriesCsv joins multiple regulation labels into one cell`
* 移行マイグレーションの確認: 既存エントリー 1 件につき `entry_regulations` が 1 行できること

#### 依存タスク

* Task 3-2, Task 3-3, Task 9-1
