[← tasks.md](../tasks.md) / Phase 12: 性能・効率の改善

### Task 12-4: 不足しているインデックスの追加

#### 実装・更新内容

* 現在張られているインデックスは `entries (tournament_id, created_at)`(0005)と `password_reset_tokens (participant_id)`(0012)、それに主キーと unique 制約が作る分だけ。以下が抜けている。
* **`regulations (tournament_id)`** — `unique (id, tournament_id)` は先頭列が `id` なので `where tournament_id = ?` には使えない。エントリーフォームを開くたびに走るクエリなので影響が大きい。→ **Task 9-1 のマイグレーションで `(tournament_id, display_order)` として追加済み**。本タスクでは重複して張らないよう確認するだけ。
* **`email_verification_tokens (entry_id)`** — メール送信に失敗したときのロールバック(`lib/entries.ts` の `delete().eq('entry_id', ...)`)と、キャンセル時にトークンを焼く処理(`0006_cancel_own_entry_fn.sql`)が `entry_id` で引く。
* **`participants (region_id)` / `staff_accounts (region_id)`** — 外部キーにインデックスが無い。参照元を引く用途は今のところ無いが、Postgres は親行の削除・更新時に子テーブルを毎回シーケンシャルスキャンする。地域を消す運用は無い(Task 9-2)ので**優先度は低い**が、コストが小さいので同時に張る。
* 逆に、**張らないもの**も判断として記録する:
  * `entries (participant_id)` — `unique (participant_id, tournament_id)` の先頭列が `participant_id` なので、マイページの一覧はこれで引ける。
  * `form_field_defs (tournament_id)` — `unique (tournament_id, field_key)` で同様。
  * `entries (status)` — 単独では選択度が低く(4 値しかない)、実際のクエリは必ず `tournament_id` と併用される。`(tournament_id, created_at)` で足りる。
* 追加後、`explain analyze` で主要クエリのプランが Index Scan になったことを確認し、結果をマイグレーションのコメントに残す。

#### コードスニペット

`supabase/migrations/0020_missing_indexes.sql`

```sql
-- メール送信に失敗したエントリーのロールバック(lib/entries.ts)と、
-- キャンセル時のトークン焼却(0006_cancel_own_entry_fn.sql)がここを引く。
create index email_verification_tokens_entry_id_idx
  on email_verification_tokens (entry_id);

-- 外部キーの子側。参照元から引く用途は現状無いが、親行の削除・更新のたびに
-- Postgres がこの列をスキャンする。地域を消す運用は無い(Task 9-2)ので
-- 優先度は低い。コストが小さいので併せて張っておく。
create index participants_region_id_idx on participants (region_id);
create index staff_accounts_region_id_idx on staff_accounts (region_id);

-- regulations (tournament_id, display_order) は 0014(Task 9-1)で追加済み。
-- entries (participant_id) と form_field_defs (tournament_id) は、それぞれ
-- unique 制約が先頭列にその列を持つため不要。
```

#### テスト

* In `apps/backend/src/lib/db-schema.test.ts`
  * `email_verification_tokens has an index on entry_id`
  * `regulations has an index usable for a tournament_id lookup`
  * `no duplicate index is created for regulations`
* 計測: 以下のクエリで `explain analyze` を取り、Seq Scan が消えたことを確認する
  * `select * from regulations where tournament_id = $1 order by display_order`
  * `delete from email_verification_tokens where entry_id = $1`

#### 依存タスク

* Task 1-1, Task 9-1
