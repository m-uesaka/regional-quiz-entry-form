[← tasks.md](../tasks.md) / Phase 10: 要件との差分の解消

### Task 10-5: エントリー期間外アクセス制御をバックエンドにも実装する

#### 実装・更新内容

* 要件は「エントリーフォームの URL は、エントリー期間中はオープンアクセス、期間外は**地域スタッフ及び統括スタッフのみ**アクセス可能」。現在この判定は SvelteKit の `load` にしか無い(`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/entry/+page.server.ts`)。
* 問題は 2 点:
  1. **バックエンドは期間外でも素通し**。`GET /api/tournaments/:regionSlug/:tournamentSlug`、`/regulations`、`/form-definitions/:tournamentId` はいずれも無認証・無条件で応答する。ページを迂回すればフォームの中身は誰でも読める。個人情報は含まないが、要件が求めているのは「スタッフが事前に内容を確認するための非公開期間」なので、そこが機能していない。
  2. **フロント側の判定が `locals.staff` の有無だけ**。他地域の地域スタッフでも期間外フォームを見られる。要件の「地域スタッフ(=その大会の担当)及び統括スタッフ」より広い。
* バックエンドに「期間外はスタッフのみ」のミドルウェアを 1 つ用意し、上記 3 つの公開 GET に適用する。判定は `middleware/staff-auth.ts` の `readStaffClaims()` と `isInScope()` を再利用する(いま module private なので export する)。
* フロント側の判定も同じスコープ規則に揃える。`locals.staff.role === 'general'`、または `regionId` / `tournamentType` が当該大会と一致する場合のみ通す。
* 公開エントリーリスト(`/entry-list`)は対象外。エントリー期間が終わった後こそ見られるべきものなので、常に公開のままにする。

#### コードスニペット

`apps/backend/src/middleware/entry-period.ts`(新規)

```typescript
/**
 * エントリー期間中は誰でも通し、期間外はその大会の担当スタッフか統括スタッフ
 * だけを通す。要件の「期間外は地域スタッフ及び統括スタッフのみがアクセス可能」
 * (スタッフが公開前にフォームを検分するための窓)をバックエンド側で担保する。
 *
 * 公開エントリーリストには掛けない: あれは期間終了後にこそ読まれるもの。
 */
export function requireOpenEntryPeriodOrStaff(
  resolveTournament: (c: Context<Env>) => Promise<TournamentScope | null>,
) {
  return createMiddleware<Env>(async (c, next) => {
    const tournament = await resolveTournament(c);
    if (!tournament) {
      return c.json({error: 'tournament not found'}, 404);
    }
    if (isWithinEntryPeriod(tournament.entry_opens_at, tournament.entry_closes_at)) {
      await next();
      return;
    }
    const staff = await readStaffClaims(
      getCookie(c, STAFF_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    // 「スタッフであること」では足りない。担当外の地域スタッフは、期間外の
    // 他地域のフォームを見る理由が無い。
    if (!staff || (staff.role !== 'general' && !isInScope(staff, tournament))) {
      return c.json({error: 'entry period closed'}, 403);
    }
    await next();
  });
}
```

`apps/frontend/src/routes/[regionSlug]/[tournamentSlug]/entry/+page.server.ts`(改修)

```typescript
  if (
    !isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt) &&
    !canPreviewTournament(locals.staff, tournament)
  ) {
    error(403, 'エントリー期間外です');
  }
```

`packages/shared/src/logic/staff-scope.ts`(新規)

```typescript
/**
 * `staff` がこの大会を扱えるか。統括スタッフは全大会、地域スタッフは
 * 自分の地域 × 大会種別のみ。バックエンドの `isInScope()` と同じ規則を
 * フロントエンドからも使えるようにここへ置く。
 */
export function canPreviewTournament(
  staff: StaffClaims | null,
  tournament: {regionId: string; type: TournamentType},
): boolean {
  if (!staff) return false;
  if (staff.role === 'general') return true;
  return staff.regionId === tournament.regionId
    && staff.tournamentType === tournament.type;
}
```

#### テスト

* In `packages/shared/src/logic/staff-scope.test.ts`
  * `canPreviewTournament rejects an anonymous visitor`
  * `canPreviewTournament accepts general staff for any tournament`
  * `canPreviewTournament rejects regional staff of another region`
  * `canPreviewTournament rejects regional staff of the other tournament type`
* In `apps/backend/src/routes/tournaments.test.ts`
  * `GET /tournaments/:regionSlug/:tournamentSlug returns 403 outside the entry period without a session`
  * `... returns the tournament outside the entry period for its own regional staff`
  * `... returns 403 outside the entry period for another region's staff`
* In `apps/backend/src/routes/regulations.test.ts` / `form-definitions.test.ts`
  * 同じ 3 ケースを各エンドポイントで
* In `apps/backend/src/routes/entry-list.test.ts`
  * `GET /tournaments/:id/entry-list stays public after the entry period`

#### 依存タスク

* Task 3-6, Task 6-1
