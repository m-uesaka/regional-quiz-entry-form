[← tasks.md](../tasks.md) / Phase 1: データモデル設計 ✅完了

### Task 1-3: フォーム項目定義 YAML のスキーマとパーサ ✅

#### 実装・更新内容

* 地域ごとの追加フォーム項目を記述する YAML のスキーマを Zod で定義し(`FormDefinitionYamlSchema`)、パース関数 `parseFormDefinitionYaml` を `packages/shared` に実装する。
* パース結果を Task 1-1 の `form_field_defs` テーブルの行群に変換するユーティリティも用意する。

#### コードスニペット

`packages/shared/src/schemas/form-definition.ts`

```typescript
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

export const FormFieldTypeSchema = z.enum(['checkbox', 'radio', 'textarea']);

export const FormFieldDefYamlSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: FormFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

export const FormDefinitionYamlSchema = z.object({
  tournamentSlug: z.string(),
  fields: z.array(FormFieldDefYamlSchema),
});
export type FormDefinitionYaml = z.infer<typeof FormDefinitionYamlSchema>;

export function parseFormDefinitionYaml(yamlText: string): FormDefinitionYaml {
  return FormDefinitionYamlSchema.parse(parseYaml(yamlText));
}
```

#### テスト

* In `packages/shared/src/schemas/form-definition.test.ts`
  * `parseFormDefinitionYaml parses a valid document`
    * checkbox/radio/textarea を1つずつ含む YAML 文字列を渡し、`fields.length === 3` を assert する
  * `parseFormDefinitionYaml rejects an invalid field key`
    * `key` に大文字を含む YAML を渡し、`ZodError` が投げられることを assert する

#### 依存タスク

* Task 1-2
