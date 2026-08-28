[← tasks.md](../tasks.md) / Phase 12: 性能・効率の改善

### Task 12-2: 一覧 API のページネーション

#### 実装・更新内容

* エントリー一覧は**公開・スタッフ向けともに全件返す**。`fetchAllRows()` が 500 行ずつ内部で回して集め、ハンドラはそれを丸ごと JSON にする(`routes/entry-list.ts`, `routes/staff-entries.ts`)。SvelteKit の `load` の戻り値は SSR された HTML に埋め込まれるので、**定員の大きい地域ではページの重さが参加者数に比例して増える**。エントリー締切直前、公開リストへのアクセスが集中する時間帯に効いてくる。
* `fetchAllRows()` は終了条件が「空バッチが返ること」なので、**常に必要回数 + 1 回**クエリを投げる。500 件以下の大会でも 2 回。これは意図的な設計(短いページが「最終ページ」か「サーバ側 `max_rows` による切り詰め」か区別できないため)で、`supabase/config.toml` の `max_rows = 1000` を `SELECT_PAGE_SIZE = 500` が下回っている限り安全に 1 回減らせる。判定を「`batch.length < pageSize` なら終了」に変えられるが、**`max_rows` を下げると壊れる**ので、両者の関係をテストで固定する。
* API に `limit` / `offset`(または `cursor`)を追加し、既定を 100 件にする。
  * 公開エントリーリスト: ページャを付ける。並び順は `created_at, id` で安定しているのでオフセットで足りる。
  * スタッフ一覧: ページャに加えて `status` での絞り込みを付ける。スタッフが実際にやりたいのは「キャンセル待ちだけ見たい」「未確認だけ見たい」であって、全件スクロールではない。
  * CSV エクスポートは全件のまま(用途がそれ)。ただし `fetchAllRows()` を使い続ける旨をコメントに残す。
* 総件数はダッシュボードの集計関数(`tournament_entry_summary()`)と同じ考え方で、`count: 'exact'` を使って 1 回で取る。

#### コードスニペット

`packages/shared/src/schemas/pagination.ts`(新規)

```typescript
export const PAGE_SIZE_DEFAULT = 100;
export const PAGE_SIZE_MAX = 500;

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

/** 1 ページ分の結果と、ページャを描くのに要る総件数。 */
export const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({items: z.array(item), total: z.number().int(), limit: z.number().int(), offset: z.number().int()});
```

`apps/backend/src/routes/entry-list.ts`(改修)

```typescript
    const {limit, offset} = c.req.valid('query');
    // count: 'exact' で総件数を同じ往復で取る。ページャの「n 件中 m〜k」を
    // 出すのに別クエリを足さずに済む。
    const {data, count, error} = await db
      .from('entries')
      .select('display_name, status, waitlist_position', {count: 'exact'})
      .eq('tournament_id', tournamentId)
      .in('status', ['confirmed', 'waitlisted', 'cancelled'])
      .order('created_at', {ascending: true})
      .order('id', {ascending: true})
      .range(offset, offset + limit - 1)
      .returns<EntryListRow[]>();
```

`apps/backend/src/lib/paged-select.ts`(改修)

```typescript
    // 短いページは「最後のページ」か「サーバ側 max_rows による切り詰め」か
    // 区別できない --- ただし SELECT_PAGE_SIZE が config.toml の max_rows を
    // 下回っている限り、切り詰めは起こり得ないので短いページで打ち切れる。
    // この前提は paged-select.test.ts が config.toml を読んで固定している。
    if (batch.length < pageSize) {
      return {rows, error: null};
    }
```

#### テスト

* In `apps/backend/src/lib/paged-select.test.ts`
  * `fetchAllRows stops on a short page`
  * `fetchAllRows issues exactly one query for a result smaller than the page size`
  * `SELECT_PAGE_SIZE stays below the max_rows configured in supabase/config.toml`
* In `apps/backend/src/routes/entry-list.test.ts`
  * `GET /entry-list returns the first page and the total count`
  * `GET /entry-list honours limit and offset`
  * `GET /entry-list rejects a limit over the maximum`
  * `GET /entry-list keeps a stable order across page boundaries`
* In `apps/backend/src/routes/staff-entries.test.ts`
  * `GET /staff/.../entries filters by status`
  * `GET /staff/.../entries.csv still exports every row`
* In `apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/list/page.svelte.test.ts`
  * `the pager renders the total count and disables the previous link on the first page`

#### 依存タスク

* Task 4-1, Task 6-2
