[← tasks.md](../tasks.md) / Phase 9: 管理機能の欠落解消(運用ブロッカー)

### Task 9-2: 地域(regions)管理 API

#### 実装・更新内容

* `regions` への書き込み API が無く、地域の追加は Supabase を直接操作する運用になっている(起票時点の `docs/api-endpoints.md`「未実装のエンドポイント」に記載)。地域を作らないと大会も作れないため、統括スタッフが自力で新地域を立ち上げられない。
* 統括スタッフ限定の `GET / POST / PATCH /api/regions` を追加する。大会作成画面が `regionId` を選ぶために一覧を必要とするので、GET も同時に用意する(現状は地域一覧を返す API すら無く、大会作成フォームは UUID の直接入力になっている)。
* `slug` はエントリーフォーム URL(`/{regionSlug}/{tournamentSlug}/entry`)の一部になる。後から変えると公開済み URL が壊れるため、**作成時のみ指定可・更新不可**とし、URL に使える文字だけに制限する。
* 削除は提供しない。`tournaments` / `participants` / `staff_accounts` から参照されており、地域を消す運用は想定しない(誤操作の被害が大きい割に需要が無い)。

#### コードスニペット

`packages/shared/src/schemas/region.ts`(新規)

```typescript
import {z} from 'zod';

// URL の 1 セグメントとしてそのまま使うので、パス・クエリで意味を持つ文字と
// 大文字を弾く。先頭は英字に固定して、UUID や数値 id と見分けがつくようにする。
export const RegionSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,30}$/, {
    message: 'slug は英小文字で始まり、英小文字・数字・ハイフンのみ使えます',
  });

export const RegionSchema = z.object({
  id: z.string().uuid(),
  slug: RegionSlugSchema,
  name: z.string().min(1).max(100),
});
export type Region = z.infer<typeof RegionSchema>;

export const RegionCreateInputSchema = RegionSchema.omit({id: true});
// slug は公開 URL の一部なので作成後は変更させない。
export const RegionUpdateInputSchema = RegionSchema.pick({name: true});
```

`apps/backend/src/routes/regions.ts`(新規)

```typescript
export const regionsRoute = new Hono<StaffEnv>()
  .use('*', requireGeneralStaff())
  .get('/', async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('regions')
      .select('id, slug, name')
      .order('name', {ascending: true})
      .returns<RegionRow[]>();
    if (error) {
      return c.json(internalError('failed to read the regions', error), 500);
    }
    return c.json(data.map(rowToRegion));
  })
  .post('/', zValidator('json', RegionCreateInputSchema), async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('regions')
      .insert(c.req.valid('json'))
      .select('id, slug, name')
      .single();
    if (error) {
      // 23505 = unique violation。slug の重複はスタッフが直せる入力ミスなので、
      // 500 ではなく 409 で「その slug は使用済み」と返す。
      if (error.code === '23505') {
        return c.json({error: 'slug already in use'}, 409);
      }
      return c.json({error: error.message}, 400);
    }
    return c.json(rowToRegion(data as RegionRow), 201);
  })
  .patch('/:id', /* name のみ更新。PGRST116 は 404 に読み替える */);
```

`apps/backend/src/index.ts`(追記)

```typescript
  .route('/regions', regionsRoute)
```

#### テスト

* In `packages/shared/src/schemas/region.test.ts`
  * `RegionSlugSchema rejects uppercase, leading digits and path separators`
  * `RegionUpdateInputSchema does not accept a slug`
* In `apps/backend/src/routes/regions.test.ts`
  * `GET /regions returns 401 without a staff session`
  * `GET /regions returns 403 for regional staff`
  * `POST /regions creates a region and returns 201`
  * `POST /regions returns 409 for a duplicate slug`
  * `PATCH /regions/:id updates the name and leaves the slug untouched`
  * `PATCH /regions/:id returns 404 for an unknown region`

#### 依存タスク

* Task 6-1
