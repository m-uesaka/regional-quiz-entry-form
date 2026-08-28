[← tasks.md](../tasks.md) / Phase 12: 性能・効率の改善

### Task 12-3: 公開エントリーリストのキャッシュ

#### 実装・更新内容

* `Cache-Control` を設定している箇所がコードベースに 1 つも無い(`setHeaders` / `Cache-Control` の使用が 0 件)。公開エントリーリストは**エントリー締切直前に最もアクセスが集中し、かつ全員が同じ内容を見る**ページなので、ここだけでもエッジキャッシュを効かせる価値が大きい。現状は参加者がリロードするたびに Worker → Supabase の往復が発生する。
* 方針:
  * `GET /api/tournaments/:tournamentId/entry-list` に `Cache-Control: public, max-age=30, stale-while-revalidate=300` を付ける。エントリーリストは「30 秒古くても実害が無い」性質のデータで、逆に厳密な即時性を求める画面ではない。
  * 公開リストページ(`/[regionSlug]/[tournamentSlug]/list`)の `load` で `setHeaders()` に同じ値を渡す。**`load` が個人化されたデータを返していないことが前提**なので、`locals` を読んでいないことをコメントで明示する。
  * `/mypage` `/staff` `/admin` には Task 11-5 で `private, no-store` を付ける。キャッシュを入れるなら、入れてはいけない場所を同時に閉じるのが安全。
* エントリー登録・確認・キャンセルの直後に自分の名前がリストに出ないことになるが、**マイページ側でステータスを確認できる**のでそちらへ導線を出す(既に確認フローの完了画面がある)。
* Cloudflare Cache API で明示的にキャッシュを操作する案もあるが、`Cache-Control` を返すだけでエッジは効く。まずヘッダだけで始め、足りなければ Cache API を検討する。

#### コードスニペット

`apps/backend/src/routes/entry-list.ts`(改修)

```typescript
// 締切直前に最も読まれ、全員が同じ内容を見る。30 秒の陳腐化は許容範囲で、
// その間の Worker → Supabase の往復が丸ごと消える。
// stale-while-revalidate を長めに取るのは、オリジンが詰まっている間も
// 古い内容を返し続けられるようにするため。
const ENTRY_LIST_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=300';

    return c.json(rows.map(rowToEntryListItem), 200, {
      'Cache-Control': ENTRY_LIST_CACHE_CONTROL,
    });
```

`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/list/+page.server.ts`(改修)

```typescript
export const load: PageServerLoad = async ({params, fetch, setHeaders}) => {
  /* ... */
  // このページは locals を一切読まない(個人化された内容が無い)ので、
  // 共有キャッシュに載せてよい。ログイン状態でヘッダの表示が変わるような
  // 変更を入れるときは、ここを private に戻すこと。
  setHeaders({'cache-control': 'public, max-age=30'});
  return {tournament, entries};
};
```

#### テスト

* In `apps/backend/src/routes/entry-list.test.ts`
  * `GET /entry-list answers with a public cache-control header`
* In `apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/list/page.server.test.ts`
  * `load sets a public cache-control header`
  * `load reads nothing from locals`(個人化されていないことの回帰テスト)
* In `apps/frontend/src/hooks.server.test.ts`
  * `a mypage response is not publicly cacheable`
* 手動確認: 本番で `cf-cache-status: HIT` が返ること

#### 依存タスク

* Task 4-1, Task 4-2, Task 11-5
