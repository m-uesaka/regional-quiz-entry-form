[← tasks.md](../tasks.md) / Phase 1: データモデル設計 ✅完了

### Task 1-2: `packages/shared` の Zod スキーマ定義 ✅

#### 実装・更新内容

* Task 1-1 のテーブル構造に対応する Zod スキーマを `packages/shared/src/schemas/*` に定義する。
* リクエスト用スキーマ(例: `EntryInputSchema`)とレスポンス/DB 表現用の型(例: `Entry`)を分けて定義し、パスワード確認欄など「DB には保存しないが入力時には必要なフィールド」を明確にする。

#### コードスニペット

`packages/shared/src/schemas/entry.ts`

```typescript
import { z } from 'zod';

export const EntryInputSchema = z
  .object({
    name: z.string().min(1),
    furigana: z.string().min(1),
    displayName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    passwordConfirm: z.string().min(8),
    regulationId: z.string().uuid(),
    freeText: z.string().optional(),
    customFieldValues: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'パスワードが一致しません',
  });
export type EntryInput = z.infer<typeof EntryInputSchema>;

export const EntryStatusSchema = z.enum([
  'pending_verification',
  'confirmed',
  'waitlisted',
  'cancelled',
]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const EntrySchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  name: z.string(),
  furigana: z.string(),
  displayName: z.string(),
  regulationId: z.string().uuid(),
  freeText: z.string().nullable(),
  customFieldValues: z.record(z.string(), z.unknown()),
  status: EntryStatusSchema,
  waitlistPosition: z.number().int().nullable(),
});
export type Entry = z.infer<typeof EntrySchema>;
```

`packages/shared/src/schemas/tournament.ts`

```typescript
import { z } from 'zod';

export const TournamentTypeSchema = z.enum(['saikyoi', 'shinjinou']);
export type TournamentType = z.infer<typeof TournamentTypeSchema>;

export const TournamentSchema = z.object({
  id: z.string().uuid(),
  regionId: z.string().uuid(),
  type: TournamentTypeSchema,
  name: z.string(),
  capacity: z.number().int().positive().nullable(),
  entryOpensAt: z.string().datetime(),
  entryClosesAt: z.string().datetime(),
});
export type Tournament = z.infer<typeof TournamentSchema>;
```

#### テスト

* In `packages/shared/src/schemas/entry.test.ts`
  * `EntryInputSchema rejects mismatched password confirmation`
    * `password` と `passwordConfirm` を違う値にして parse し、`passwordConfirm` パスにエラーが出ることを assert する
  * `EntryInputSchema accepts a valid payload`
    * 正常系データで `success: true` になることを assert する

#### 依存タスク

* Task 0-2, Task 1-1
