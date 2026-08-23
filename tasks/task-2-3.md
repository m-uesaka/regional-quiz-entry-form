[← tasks.md](../tasks.md) / Phase 2: 大会・フォーム定義管理(統括スタッフ)

### Task 2-3: Google スプレッドシート → YAML 変換ツール

#### 実装・更新内容

* 地域スタッフが記入した Google スプレッドシートの内容を、統括スタッフが URL 指定で取り込み、Task 1-3 の YAML 形式に変換するツールを実装する。
* Google Sheets API(サービスアカウント認証)でシート内容を取得し、決め打ちの列フォーマット(`key`, `label`, `type`, `required`, `options`)からフィールド定義配列に変換する。
* 変換結果はプレビュー用に返すのみとし、実際の保存は Task 2-2 の API を呼び出す形にする(変換と保存を分離)。

#### コードスニペット

`apps/backend/src/lib/sheet-to-form-definition.ts`

```typescript
import { stringify as stringifyYaml } from 'yaml';
import { FormFieldDefYamlSchema } from '@regional-quiz/shared';

interface SheetRow {
  key: string;
  label: string;
  type: string;
  required: string;
  options: string;
}

export async function fetchSheetRows(
  spreadsheetId: string,
  apiKey: string,
): Promise<SheetRow[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A2:E?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.status}`);
  const { values } = (await res.json()) as { values: string[][] };
  return values.map(([key, label, type, required, options]) => ({
    key,
    label,
    type,
    required,
    options,
  }));
}

export function sheetRowsToYaml(tournamentSlug: string, rows: SheetRow[]): string {
  const fields = rows.map((row) =>
    FormFieldDefYamlSchema.parse({
      key: row.key,
      label: row.label,
      type: row.type,
      required: row.required === 'TRUE',
      options: row.options ? row.options.split(',').map((s) => s.trim()) : undefined,
    }),
  );
  return stringifyYaml({ tournamentSlug, fields });
}
```

`apps/backend/src/routes/sheet-import.ts`

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types/env';
import { requireGeneralStaff } from '../middleware/staff-auth';
import { fetchSheetRows, sheetRowsToYaml } from '../lib/sheet-to-form-definition';

const ImportSchema = z.object({ spreadsheetId: z.string(), tournamentSlug: z.string() });

export const sheetImportRoute = new Hono<Env>()
  .use('*', requireGeneralStaff())
  .post('/preview', zValidator('json', ImportSchema), async (c) => {
    const { spreadsheetId, tournamentSlug } = c.req.valid('json');
    const rows = await fetchSheetRows(spreadsheetId, c.env.MAIL_API_KEY);
    return c.json({ yaml: sheetRowsToYaml(tournamentSlug, rows) });
  });
```

#### テスト

* In `apps/backend/src/lib/sheet-to-form-definition.test.ts`
  * `sheetRowsToYaml converts rows into valid yaml`
    * checkbox 用 row(options カンマ区切り)を渡し、`parseFormDefinitionYaml`(Task 1-3)にかけて往復できることを assert する
  * `sheetRowsToYaml throws on invalid field key`
    * 不正な `key` の row を渡し、`ZodError` が投げられることを assert する

#### 依存タスク

* Task 1-3, Task 2-2
