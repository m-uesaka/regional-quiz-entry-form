[← tasks.md](../tasks.md) / Phase 12: 性能・効率の改善

### Task 12-1: 大会取得まわりの DB 往復削減

#### 実装・更新内容

* スタッフ画面を 1 枚描くのに DB 往復が 4 回以上ある。内訳:
  1. `GET /api/tournaments/:regionSlug/:tournamentSlug` が **2 クエリ**(`regions` から id を引いてから `tournaments` を引く、`routes/tournaments.ts`)。
  2. その結果の `tournament.id` を使って `GET /api/staff/tournaments/:id/entries` を呼ぶ(`load` 内で**直列**、id が要るので避けられない)。
  3. その入口で `requireStaffForTournament()` が**同じ `tournaments` 行をもう一度**引いてスコープを判定する(`middleware/staff-auth.ts`)。
  4. ハンドラが `entries` を引く。
* 直す順に効果が大きい:
  * **(1) を 1 クエリにする**。`regions!inner(slug)` の埋め込みで `region.slug` を条件にすれば 1 回で済む。この関数はほぼ全ページの `load` の入口なので、ここだけで全画面が 1 往復ずつ軽くなる。
  * **(3) の重複読みを消す**。ミドルウェアが読んだ `tournaments` 行を `c.set('tournament', ...)` で渡し、ハンドラ側は再取得しない。統括スタッフはスコープ判定をスキップするので行を読んでいない点に注意が要る(その場合はハンドラ側で読む)。
  * **`GET /api/tournaments/:id` を追加する**。大会編集画面が「全大会を取ってきてクライアント側で `find`」している(`admin/tournaments/[id]/edit/+page.ts` に自認コメントあり)。大会数はたかが知れているが、統括スタッフしか見ない画面のために全件を返すのは筋が悪い。
* `:id`(UUID)と `:regionSlug/:tournamentSlug`(2 セグメント)のルーティングが衝突しないことを確認する。`index.ts` のマウント順のコメントにあるとおり、この配下は既にパス形状の競合に敏感になっている。

#### コードスニペット

`apps/backend/src/routes/tournaments.ts`(改修)

```typescript
  .get(
    '/:regionSlug/:tournamentSlug',
    zValidator('param', TournamentBySlugParamSchema),
    async c => {
      const {regionSlug, tournamentSlug} = c.req.valid('param');
      // regions を引いてから tournaments を引く 2 段構えをやめる。
      // `!inner` で内部結合にすれば、地域が無い場合も 0 行として同じ経路で
      // 扱えるので、404 の分岐も 1 つに減る。
      const {data, error} = await createDbClient(c.env)
        .from('tournaments')
        .select('id, region_id, type, name, capacity, entry_opens_at, entry_closes_at, regions!inner(slug)')
        .eq('regions.slug', regionSlug)
        .eq('type', tournamentSlug)
        .returns<TournamentRow[]>()
        .maybeSingle();
      if (error) {
        return c.json(internalError('failed to read the tournament', error), 500);
      }
      if (!data) {
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.json(rowToTournament(data));
    },
  );
```

`apps/backend/src/middleware/staff-auth.ts`(改修)

```typescript
    if (staff.role !== 'general') {
      /* 既存のスコープ判定 */
      // 読んだ行をハンドラへ渡す。同じ大会をもう一度引くのは無駄で、
      // かつ 2 回の読み取りの間に更新が挟まると判定と表示がずれる。
      c.set('tournament', tournament);
    }
    // 統括スタッフはスコープ判定を飛ばすので行を読んでいない。ハンドラ側は
    // 「あれば使う、無ければ自分で読む」で書く必要がある。
```

#### テスト

* In `apps/backend/src/routes/tournaments.test.ts`
  * `GET /tournaments/:regionSlug/:tournamentSlug returns 404 for an unknown region`
  * `GET /tournaments/:regionSlug/:tournamentSlug returns 404 for a known region without that tournament type`
  * `GET /tournaments/:regionSlug/:tournamentSlug resolves in a single query`(Supabase クライアントのモックで呼び出し回数を検証)
  * `GET /tournaments/:id returns the tournament for general staff`
  * `GET /tournaments/:id returns 403 for regional staff`
  * `GET /tournaments/:id does not shadow the two-segment slug route`
* In `apps/backend/src/middleware/staff-auth.test.ts`
  * `requireStaffForTournament exposes the tournament it read to the handler`
  * `requireStaffForTournament sets no tournament for general staff`
* In `apps/frontend/src/routes/admin/tournaments/[id]/edit/page.test.ts`
  * `load fetches only the tournament it needs`

#### 依存タスク

* Task 2-1, Task 6-2
