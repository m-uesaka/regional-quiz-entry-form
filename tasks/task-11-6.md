[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-6: 認可の抜け漏れを構造的に防ぐ(ルート網羅テスト)

#### 実装・更新内容

* DB アクセスはすべて service_role キーで行っている(`lib/db.ts`)。`0001_init.sql` は全テーブルで RLS を有効にしているが、**service_role は RLS をバイパスする**ため、これは実質的に「anon / authenticated からの直接アクセスを塞ぐ」以上の意味を持たない。つまり**認可は 100% Worker のミドルウェア頼み**で、多層防御が無い。
* 現状のスコープ判定自体は正しく書けている(`requireStaffForTournament()` / `requireStaffForEntry()` は大会・エントリー経由で `region_id` と `type` を照合している)。危ういのは仕組みの側で、**ルートを 1 本足してミドルウェアを付け忘れると、その瞬間に全地域の個人情報が無認証で読める**。しかも `routes/tournaments.ts` や `routes/form-definitions.ts` のように「同じファイル内に公開ルートと保護ルートが混在し、`.use('*', ...)` ではなくルート単位で付けている」箇所があるため、付け忘れがレビューで見えにくい。
* 対策 A(本タスクの主眼): **公開ルートの許可リストを明示し、それ以外のルートが無認証で通らないことをテストで保証する**。Hono の `app.routes` は登録済みのメソッド + パスを列挙できるので、テーブル駆動で全ルートに無認証リクエストを投げ、許可リストに無いものが 401/403 以外を返したら失敗させる。ルートを足すたびに、開発者は「公開」と明示するか認証を付けるかの二択を迫られる。
* 対策 B(将来の選択肢として記録のみ): service_role をやめ、リクエストごとに参加者/スタッフの JWT を Supabase クライアントに渡して RLS ポリシーで縛る。多層防御としては本命だが、全クエリの書き換えとポリシー設計が要る大改修で、現時点の規模には見合わない。**採らない理由をここに残しておく**ことが目的。
* 併せて、`docs/api-endpoints.md` の各エンドポイント表に「認証」列があるので、許可リストとこの表の内容が一致することもテストで確認する(ドキュメントと実装のずれを検出する)。

#### コードスニペット

`apps/backend/src/routes-authz.test.ts`(新規)

```typescript
/**
 * 無認証で到達してよいルートの許可リスト。ここに無いルートは、セッション
 * 無しのリクエストに対して必ず 401 か 403 を返さなければならない。
 *
 * 認可はすべて Worker のミドルウェアが担っている(DB は service_role で
 * 触っており RLS はバイパスされる)ため、ミドルウェアの付け忘れを止める
 * 仕組みが他に無い。ルートを足したらここに公開と書くか、認証を付けるか。
 */
const PUBLIC_ROUTES: ReadonlyArray<[string, string]> = [
  ['GET', '/api/healthz'],
  ['GET', '/api/tournaments/:regionSlug/:tournamentSlug'],
  ['GET', '/api/tournaments/:tournamentId/regulations'],
  ['GET', '/api/tournaments/:tournamentId/entry-list'],
  ['GET', '/api/form-definitions/:tournamentId'],
  ['POST', '/api/tournaments/:tournamentId/entries'],
  ['POST', '/api/auth/staff/login'],
  ['POST', '/api/auth/participant/login'],
  ['POST', '/api/auth/participant/password-reset/request'],
  ['POST', '/api/auth/participant/password-reset/confirm'],
  ['POST', '/api/entries/verify'],
];

describe('route authorization coverage', () => {
  // app.routes は登録済みの (method, path) を列挙する。ミドルウェア自身も
  // ここに現れるので、ハンドラだけに絞り込んでから突き合わせる。
  const registered = collectHandlerRoutes(app);

  it('has no route missing from either the allow list or the auth check', async () => {
    for (const [method, path] of registered) {
      if (PUBLIC_ROUTES.some(([m, p]) => m === method && p === path)) continue;
      const res = await app.request(toConcretePath(path), {method}, testEnv());
      expect([401, 403], `${method} ${path} is reachable without a session`)
        .toContain(res.status);
    }
  });

  it('has no stale entry in the allow list', () => {
    for (const [method, path] of PUBLIC_ROUTES) {
      expect(registered).toContainEqual([method, path]);
    }
  });
});
```

#### テスト

* In `apps/backend/src/routes-authz.test.ts`
  * `has no route missing from either the allow list or the auth check`
  * `has no stale entry in the allow list`
  * `the allow list matches the 認証 column of docs/api-endpoints.md`
* 回帰確認: 認証ミドルウェアを 1 つ外した状態でテストが赤くなることを手で確かめる(テスト自身が機能していることの確認)

#### 依存タスク

* Task 5-1, Task 6-1
