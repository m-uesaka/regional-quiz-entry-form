[← tasks.md](../tasks.md) / Phase 9: 管理機能の欠落解消(運用ブロッカー)

### Task 9-3: スタッフアカウント管理 API

#### 実装・更新内容

* `staff_accounts` への insert がコードベースに 1 箇所も無く、スタッフの発行は Supabase 上で行を直接作る運用になっている。しかも `password_hash` は `apps/backend/src/lib/password.ts` の PBKDF2 形式なので、**アプリのコードを動かさないとハッシュを作れない**。地域スタッフを増やすたびに開発者の手作業が必要な状態を解消する。
* 統括スタッフ限定の `GET / POST /api/staff/accounts` と `POST /api/staff/accounts/:id/password-reset` を追加する。
* **初期パスワードを API のレスポンスに載せない**。作成時はアカウントだけ作り、Task 5-5 と同じワンタイムトークンをスタッフのメールアドレスへ送って本人に設定させる。これにより、統括スタッフが地域スタッフのパスワードを知っている状態を作らずに済む。
* `role = 'regional'` のアカウントは `region_id` と `tournament_type` の両方が必須、`role = 'general'` は両方 null。この不変条件は現在どこにも強制されておらず、片方だけ埋まった行を作ると `middleware/staff-auth.ts` のスコープ判定が常に false になって静かに 403 を返し続ける。Zod と DB の check 制約の双方で縛る。
* パスワード再設定トークンは参加者用の `password_reset_tokens` とは別テーブル(`staff_password_reset_tokens`)にする。既存テーブルは `participant_id` の not null FK を持っており、相乗りさせると片方が必ず null の列が増える。

#### コードスニペット

`packages/shared/src/schemas/staff.ts`(追記)

```typescript
// regional は「地域 × 大会種別」に必ず紐づき、general はどちらも持たない。
// 片方だけ埋まった行はスコープ判定を常に落とすので、型の側で作れなくする。
export const StaffAccountCreateInputSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('general'),
    email: z.string().email(),
  }),
  z.object({
    role: z.literal('regional'),
    email: z.string().email(),
    regionId: z.string().uuid(),
    tournamentType: TournamentTypeSchema,
  }),
]);
```

`apps/backend/src/routes/staff-accounts.ts`(新規)

```typescript
export const staffAccountsRoute = new Hono<StaffEnv>()
  .use('*', requireGeneralStaff())
  .get('/accounts', async c => {
    // password_hash は返さない。一覧に必要なのは誰がどの大会の担当かだけ。
    const {data, error} = await createDbClient(c.env)
      .from('staff_accounts')
      .select('id, email, role, region_id, tournament_type, regions(slug, name)')
      .order('created_at', {ascending: true})
      .returns<StaffAccountRow[]>();
    /* ... */
  })
  .post('/accounts', zValidator('json', StaffAccountCreateInputSchema), async c => {
    const input = c.req.valid('json');
    const db = createDbClient(c.env);
    // 使えないハッシュを入れておく: 行は作るが、本人が招待メールから
    // パスワードを設定するまでログインはできない。`verifyPassword()` は
    // 形式が合わない文字列に false を返すので、そのまま「常に不一致」になる。
    const {data, error} = await db
      .from('staff_accounts')
      .insert({
        email: input.email,
        password_hash: 'invalid',
        role: input.role,
        region_id: input.role === 'regional' ? input.regionId : null,
        tournament_type: input.role === 'regional' ? input.tournamentType : null,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        return c.json({error: 'email already in use'}, 409);
      }
      return c.json({error: error.message}, 400);
    }
    // 招待メール。参加者側と違い、ここは統括スタッフが結果を知るべき操作なので
    // waitUntil() には出さず、送信失敗は 500 として報告する。
    await sendStaffPasswordSetupMail(c.env, data.id, input.email);
    return c.json({id: data.id}, 201);
  });
```

`supabase/migrations/0015_staff_account_constraints.sql`

```sql
-- regional は地域と種別を必ず持ち、general はどちらも持たない。
alter table staff_accounts
  add constraint staff_accounts_scope_matches_role
  check (
    (role = 'regional' and region_id is not null and tournament_type is not null)
    or (role = 'general' and region_id is null and tournament_type is null)
  );

create table staff_password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references staff_accounts (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index staff_password_reset_tokens_staff_account_id_idx
  on staff_password_reset_tokens (staff_account_id);
alter table staff_password_reset_tokens enable row level security;
```

#### テスト

* In `apps/backend/src/routes/staff-accounts.test.ts`
  * `GET /staff/accounts returns 403 for regional staff`
  * `GET /staff/accounts never includes password_hash`
  * `POST /staff/accounts creates a general account with no region scope`
  * `POST /staff/accounts creates a regional account and sends a setup mail`
  * `POST /staff/accounts returns 409 for a duplicate email`
  * `POST /staff/accounts stores an unusable hash so the account cannot log in yet`
* In `apps/backend/src/routes/staff-auth.test.ts`(追加)
  * `POST /auth/staff/login refuses an account that has not set a password yet`
* In `apps/backend/src/lib/db-schema.test.ts`
  * `staff_accounts rejects a regional row without a region`

#### 依存タスク

* Task 5-5, Task 6-1, Task 9-2
