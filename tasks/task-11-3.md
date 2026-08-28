[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-3: スタッフセッションの失効手段

#### 実装・更新内容

* 参加者セッションには失効の仕組みがある。`participants.password_changed_at` を JWT の `pwdChangedAt` に埋め、`requireParticipant()` が毎回 DB の値と突き合わせるので、パスワードを変えれば発行済みセッションが即座に切れる(`middleware/participant-auth.ts`)。
* **スタッフ側には同じ仕組みが無い**。`requireGeneralStaff()` / `requireStaffForTournament()` は署名と `exp` しか見ておらず、漏洩したスタッフ Cookie は 12 時間、こちらから止める手段が一切ない。しかもスタッフの Cookie は**参加者全員の氏名・ふりがな・メールアドレスにアクセスできる**ので、失効できないことの影響は参加者セッションより大きい。
* `staff_accounts.sessions_valid_from timestamptz not null default now()` を追加し、参加者側と同じ形でクレームに埋めて照合する。名前を `password_changed_at` にしないのは、パスワード変更以外(退任、端末紛失)でも失効させたいため。
* 統括スタッフが `POST /api/staff/accounts/:id/revoke-sessions` でこの値を `now()` に進められるようにする。自分自身のセッションも対象にできる(端末を失くしたスタッフが自分で押せる)。
* トレードオフ: 参加者側と同様、**リクエストごとに `staff_accounts` を 1 回読む**ことになる。スタッフ用エンドポイントは元々 DB を叩くので追加の往復は 1 回で、Task 12-1 のクエリ削減と合わせれば実質的な悪化はない。DB 読み取りに失敗したときは 401 ではなく 500 を返す(参加者側と同じ理由: 障害でスタッフを閉め出さない)。

#### コードスニペット

`supabase/migrations/0018_staff_accounts_sessions_valid_from.sql`

```sql
-- 発行済みスタッフ JWT を無効化するための世代。参加者側の
-- password_changed_at と同じ役割だが、パスワード変更以外(退任・端末紛失)でも
-- 進められるようにこの名前にしている。
alter table staff_accounts
  add column sessions_valid_from timestamptz not null default now();
```

`packages/shared/src/schemas/staff.ts`(改修)

```typescript
export const StaffClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: StaffRoleSchema,
  regionId: z.string().uuid().nullable(),
  tournamentType: TournamentTypeSchema.nullable(),
  // このセッションがどの世代のものか。staff_accounts.sessions_valid_from と
  // 一致しなくなった時点で無効になる。
  sessionsValidFrom: z.number(),
});
```

`apps/backend/src/middleware/staff-auth.ts`(改修)

```typescript
/**
 * 署名だけでは「このセッションが後から切られたか」は判らない。stateless な
 * JWT なので、失効は staff_accounts.sessions_valid_from にしか現れない。
 * 参加者側(participant-auth.ts)と同じく、2 つの読み取りの一致で判定する
 * (「発行より後か」の比較にすると Worker と Postgres の時計合わせが要る)。
 */
async function isSessionCurrent(
  env: Bindings,
  staff: StaffClaims,
): Promise<{ok: true; current: boolean} | {ok: false}> {
  const {data, error} = await createDbClient(env)
    .from('staff_accounts')
    .select('sessions_valid_from')
    .eq('id', staff.sub)
    .returns<{sessions_valid_from: string}[]>()
    .maybeSingle();
  if (error) return {ok: false};
  // 行が消えている(アカウント削除)なら死んだセッションと同じ扱い。
  return {ok: true, current: !!data
    && Date.parse(data.sessions_valid_from) === staff.sessionsValidFrom};
}
```

#### テスト

* In `apps/backend/src/middleware/staff-auth.test.ts`
  * `requireGeneralStaff rejects a session issued before sessions_valid_from moved`
  * `requireStaffForTournament rejects a revoked session`
  * `the middleware answers 500, not 401, when the revocation check cannot be read`
  * `the middleware rejects a session whose staff account no longer exists`
* In `apps/backend/src/routes/staff-accounts.test.ts`
  * `POST /staff/accounts/:id/revoke-sessions moves sessions_valid_from`
  * `POST /staff/accounts/:id/revoke-sessions returns 403 for regional staff`
  * `a staff member may revoke their own sessions`

#### 依存タスク

* Task 6-1, Task 9-3
