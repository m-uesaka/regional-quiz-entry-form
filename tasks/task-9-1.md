[← tasks.md](../tasks.md) / Phase 9: 管理機能の欠落解消(運用ブロッカー)

### Task 9-1: レギュレーション登録・編集 API

#### 実装・更新内容

* `regulations` への書き込み API が存在しない。読み出し(`GET /api/tournaments/:tournamentId/regulations`)だけが実装済みで、レギュレーション本体も優先エントリー期間も Supabase を直接操作しないと設定できない状態になっている(`docs/api-endpoints.md` 15章「未実装のエンドポイント」)。要件の中核である「複数条件のレギュレーション」「優先期間中は対象者のみエントリー可」が運用できないため、これを塞ぐ。
* Task 2-2 は表題に「レギュレーション登録 API」を含むが、実装されたのは `form_field_defs` の同期のみだった。本タスクがその積み残しにあたる。
* 統括スタッフ(`requireGeneralStaff()`)限定で、大会単位の一括置き換え(PUT)を提供する。フォーム定義(`PUT /api/form-definitions/:tournamentId`)と同じ「YAML/配列で丸ごと差し替える」モデルに揃え、個別の POST/PATCH/DELETE は作らない。
* **既存エントリーが参照している行を消してはならない**。`entries.regulation_id` は複合外部キー `(regulation_id, tournament_id)` で `regulations` を参照しているため、単純な delete → insert(`sync_form_field_defs` と同じ手口)は FK 違反で失敗する。id を指定した行は update、id 無しは insert、YAML から消えた行は「参照が無ければ delete、あれば拒否」する差分同期を Postgres 関数側で行う。
* 優先期間は `priority_starts_at` / `priority_ends_at` の両方が null か両方が非 null かのどちらかであることを Zod と DB の check 制約の双方で担保する。

#### コードスニペット

`packages/shared/src/schemas/regulation.ts`(追記)

```typescript
// 保存要求。`id` を持つ要素は既存行の更新、持たない要素は新規追加を意味する。
export const RegulationUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: z.string().min(1).max(200),
    priorityStartsAt: z.string().datetime().nullable().default(null),
    priorityEndsAt: z.string().datetime().nullable().default(null),
  })
  .refine(r => (r.priorityStartsAt === null) === (r.priorityEndsAt === null), {
    message: '優先期間は開始と終了の両方を指定してください',
    path: ['priorityEndsAt'],
  })
  .refine(
    r =>
      r.priorityStartsAt === null ||
      Date.parse(r.priorityStartsAt) < Date.parse(r.priorityEndsAt!),
    {message: '優先期間の終了は開始より後にしてください', path: ['priorityEndsAt']},
  );

// `display_order` は配列の並び順から採番するので、要求には含めない。
export const RegulationSyncInputSchema = z.object({
  regulations: z.array(RegulationUpsertSchema).min(1),
});
```

`apps/backend/src/routes/regulations.ts`(既存の GET に追記)

```typescript
export const regulationsRoute = new Hono<StaffEnv>()
  .get('/:tournamentId/regulations', /* 既存の公開ルート */)
  .put(
    '/:tournamentId/regulations',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    zValidator('json', RegulationSyncInputSchema),
    async c => {
      try {
        await syncRegulations(
          c.env,
          c.req.valid('param').tournamentId,
          c.req.valid('json').regulations,
        );
      } catch (e: unknown) {
        if (e instanceof TournamentNotFoundError) {
          return c.json({error: 'tournament not found'}, 404);
        }
        // エントリーに参照されている行を消そうとした場合。どのラベルが
        // 消せなかったかはスタッフ画面がそのまま表示するので、メッセージは
        // 日本語で返す。
        if (e instanceof RegulationInUseError) {
          return c.json({error: e.message}, 409);
        }
        return c.json(internalError('failed to sync the regulations', e), 500);
      }
      return c.json({ok: true});
    },
  );
```

`supabase/migrations/0014_sync_regulations_fn.sql`

```sql
-- 大会のレギュレーションを一括同期する。form_field_defs と違って
-- delete → insert はできない: entries が (regulation_id, tournament_id) で
-- 参照しているため、参照されている行を消すと FK 違反になる。
create or replace function sync_regulations(
  p_tournament_id uuid,
  p_regulations jsonb
)
returns void
language plpgsql
as $$
declare
  v_keep uuid[];
  v_in_use text[];
begin
  -- 大会行をロックして、同時アップロード同士を直列化する。
  perform 1 from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament not found: %', p_tournament_id
      using errcode = 'P0002';
  end if;

  -- 既存行の更新と新規行の挿入。display_order は配列の添字。
  with input as (
    select
      (value ->> 'id')::uuid as id,
      value ->> 'label' as label,
      (value ->> 'priorityStartsAt')::timestamptz as priority_starts_at,
      (value ->> 'priorityEndsAt')::timestamptz as priority_ends_at,
      (ordinality - 1)::integer as display_order
    from jsonb_array_elements(p_regulations) with ordinality
  ),
  upserted as (
    insert into regulations
      (id, tournament_id, label, priority_starts_at, priority_ends_at, display_order)
    select
      coalesce(id, gen_random_uuid()), p_tournament_id, label,
      priority_starts_at, priority_ends_at, display_order
    from input
    on conflict (id) do update set
      label = excluded.label,
      priority_starts_at = excluded.priority_starts_at,
      priority_ends_at = excluded.priority_ends_at,
      display_order = excluded.display_order
    returning id
  )
  select array_agg(id) into v_keep from upserted;

  -- 消える行のうち、エントリーに使われているものを先に洗い出して拒否する。
  select array_agg(r.label) into v_in_use
  from regulations r
  where r.tournament_id = p_tournament_id
    and not (r.id = any (v_keep))
    and exists (select 1 from entries e where e.regulation_id = r.id);
  if v_in_use is not null then
    raise exception 'regulations in use: %', array_to_string(v_in_use, ', ')
      using errcode = 'P0004';
  end if;

  delete from regulations r
  where r.tournament_id = p_tournament_id and not (r.id = any (v_keep));
end;
$$;

revoke all on function sync_regulations(uuid, jsonb) from public;
grant execute on function sync_regulations(uuid, jsonb) to service_role;

-- 優先期間は「両方 null」か「両方非 null」だけを許す。Zod 側と二重に持つのは、
-- 直接 SQL を叩く運用が当面残るため。
alter table regulations
  add constraint regulations_priority_window_complete
  check (
    (priority_starts_at is null) = (priority_ends_at is null)
    and (priority_starts_at is null or priority_starts_at < priority_ends_at)
  );

-- `where tournament_id = ?` は unique (id, tournament_id) では引けない
-- (先頭列が id のため)。エントリーフォーム表示のたびに走るので張る。
create index regulations_tournament_id_display_order_idx
  on regulations (tournament_id, display_order);
```

#### テスト

* In `packages/shared/src/schemas/regulation.test.ts`
  * `RegulationUpsertSchema rejects a priority window with only one endpoint`
  * `RegulationUpsertSchema rejects a priority window that ends before it starts`
* In `apps/backend/src/routes/regulations.test.ts`
  * `PUT /tournaments/:id/regulations returns 401 without a staff session`
  * `PUT /tournaments/:id/regulations returns 403 for regional staff`
  * `PUT /tournaments/:id/regulations updates rows given an id and inserts rows without one`
  * `PUT /tournaments/:id/regulations renumbers display_order from the array order`
  * `PUT /tournaments/:id/regulations returns 409 when a removed regulation is referenced by an entry`
  * `PUT /tournaments/:id/regulations returns 404 for an unknown tournament`
* In `apps/backend/src/lib/db-schema.test.ts`
  * `regulations rejects a half-open priority window`(check 制約の存在確認)

#### 依存タスク

* Task 2-1, Task 2-2
