[← tasks.md](../tasks.md) / Phase 6: 地域スタッフ向け管理ページ

### Task 6-4: CSV 出力機能

#### 実装・更新内容

* `GET /staff/tournaments/:tournamentId/entries.csv` を実装し、エントリー内容を CSV(`text/csv`)としてストリームまたは文字列で返す。
* カスタムフィールド(`custom_field_values`)は `form_field_defs` の `label` を列見出しにして展開する。

#### コードスニペット

`apps/backend/src/lib/entries-csv.ts`

```typescript
interface EntryRow {
  name: string;
  furigana: string;
  displayName: string;
  status: string;
  customFieldValues: Record<string, string | string[]>;
}

export function buildEntriesCsv(
  fieldDefs: { key: string; label: string }[],
  entries: EntryRow[],
): string {
  const headers = ['氏名', 'ふりがな', '掲載名', 'ステータス', ...fieldDefs.map((f) => f.label)];
  const rows = entries.map((entry) => [
    entry.name,
    entry.furigana,
    entry.displayName,
    entry.status,
    ...fieldDefs.map((f) => {
      const v = entry.customFieldValues[f.key];
      return Array.isArray(v) ? v.join(';') : (v ?? '');
    }),
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
```

#### テスト

* In `apps/backend/src/lib/entries-csv.test.ts`
  * `buildEntriesCsv includes a header row derived from field labels`
  * `buildEntriesCsv escapes values containing commas or quotes`
  * `buildEntriesCsv joins multi-select checkbox values with a semicolon`

#### 依存タスク

* Task 2-2, Task 6-2
