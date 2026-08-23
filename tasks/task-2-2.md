[← tasks.md](../tasks.md) / Phase 2: 大会・フォーム定義管理(統括スタッフ)

### Task 2-2: フォーム定義・レギュレーション登録 API

#### 実装・更新内容

* 大会に紐づくフォーム定義(YAML アップロード)とレギュレーションを登録・更新する API を実装する。
* YAML アップロード時は Task 1-3 の `parseFormDefinitionYaml` を通し、`form_field_defs` テーブルへ差分反映(既存の `field_key` は update、新規は insert、YAML に無いものは削除)する。

#### コードスニペット

`apps/backend/src/routes/form-definitions.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { parseFormDefinitionYaml } from '@regional-quiz/shared';
import type { Env } from '../types/env';
import { requireGeneralStaff } from '../middleware/staff-auth';
import { syncFormFieldDefs } from '../lib/form-definitions';

const UploadYamlSchema = z.object({ yaml: z.string() });

export const formDefinitionsRoute = new Hono<Env>()
  .use('*', requireGeneralStaff())
  .put('/:tournamentId', zValidator('json', UploadYamlSchema), async (c) => {
    const parsed = parseFormDefinitionYaml(c.req.valid('json').yaml);
    await syncFormFieldDefs(c.env, c.req.param('tournamentId'), parsed.fields);
    return c.json({ ok: true });
  });
```

`apps/backend/src/lib/form-definitions.ts`

```typescript
import type { FormFieldDefYaml } from '@regional-quiz/shared';
import type { Bindings } from '../types/env';
import { createDbClient } from './db';

export async function syncFormFieldDefs(
  env: Bindings,
  tournamentId: string,
  fields: FormFieldDefYaml[],
): Promise<void> {
  const db = createDbClient(env);
  const rows = fields.map((field, index) => ({
    tournament_id: tournamentId,
    field_key: field.key,
    label: field.label,
    field_type: field.type,
    required: field.required,
    options: field.options ?? null,
    display_order: index,
  }));
  await db.from('form_field_defs').delete().eq('tournament_id', tournamentId);
  if (rows.length > 0) {
    await db.from('form_field_defs').insert(rows);
  }
}
```

#### テスト

* In `apps/backend/src/lib/form-definitions.test.ts`
  * `syncFormFieldDefs replaces existing fields`
    * 既存 2 件・新規 YAML 1 件で呼び出し、最終的にテーブルに 1 件だけ残ることを assert する(ローカル Supabase 統合テスト)

#### 依存タスク

* Task 1-3, Task 2-1
