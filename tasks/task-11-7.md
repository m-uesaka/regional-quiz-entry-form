[← tasks.md](../tasks.md) / Phase 11: セキュリティ強化

### Task 11-7: 軽微な堅牢化(入力長上限・メール本文・robots.txt)

#### 実装・更新内容

単体では小さいが、まとめて片付けた方が効率のよい項目群。

* **入力長の上限が無い**。`EntryInputSchema` の `name` / `furigana` / `displayName` / `freeText` と、custom field の textarea 回答に最大長が無く、DB 側も `text` で制約無し。1 リクエストで数 MB を保存でき、それが公開エントリーリスト(全件返す)やスタッフ一覧・CSV にそのまま乗る。Zod 側に上限を入れ、DB にも check 制約を張る(直接 SQL を叩く運用が当面残るため二重に持つ)。custom field 値は「1 要素あたり」と「合計」の両方を見る。
* **一斉メール本文が無サニタイズの HTML**。`POST /staff/tournaments/:id/mail` の `body` はスタッフが書いた HTML をそのまま送っている。スタッフ入力なので直接の脆弱性ではないが、地域スタッフのアカウントが 1 つ侵害されるだけで、**検証済み送信ドメインから担当大会の参加者全員に任意の HTML(フィッシング)を送れる**。安全なタグだけの許可リストでサニタイズし、`<a>` の href をスキーム(http/https/mailto)で制限する。
* **`robots.txt` が全許可**。公開エントリーリストは要件どおり公開でよいが、`/mypage` `/staff` `/admin` `/verify` `/password-reset` は検索結果に出る意味が無い。特に `/verify` と `/password-reset` はトークン付き URL を踏むページなので、クローラに拾わせない。
* **エラーメッセージからの情報漏れの再確認**。`internalError()` は Supabase のメッセージをログに送ってクライアントには定型文を返す設計で正しいが、`routes/tournaments.ts` の POST/PATCH は `error.message` をそのまま 400 で返している。制約違反のメッセージには列名やテーブル名が含まれるため、既知の制約(unique 違反など)だけを日本語に翻訳して返し、それ以外は定型文にする。

#### コードスニペット

`packages/shared/src/schemas/entry.ts`(改修)

```typescript
// 上限が無いと 1 件のエントリーで数 MB を保存でき、それが公開エントリー
// リスト・スタッフ一覧・CSV に丸ごと乗る。日本語の氏名・ふりがなとしては
// 十分に余裕のある値を選んでいる。
const NAME_MAX = 100;
const FREE_TEXT_MAX = 2_000;
const CUSTOM_FIELD_VALUE_MAX = 2_000;
const CUSTOM_FIELD_TOTAL_MAX = 10_000;

export const EntryInputSchema = z
  .object({
    name: z.string().min(1, {message: '氏名を入力してください'})
      .max(NAME_MAX, {message: `氏名は${NAME_MAX}文字以内で入力してください`}),
    /* furigana / displayName も同様 */
    freeText: z.string().max(FREE_TEXT_MAX).optional(),
    customFieldValues: z.record(z.string(), CustomFieldValueSchema),
  })
  .refine(data => totalLength(data.customFieldValues) <= CUSTOM_FIELD_TOTAL_MAX, {
    message: '回答が長すぎます',
    path: ['customFieldValues'],
  });
```

`supabase/migrations/0019_entry_text_length_limits.sql`

```sql
-- Zod と二重に持つ。直接 SQL でデータを入れる運用が当面残るため。
alter table entries
  add constraint entries_text_lengths check (
    char_length(name) <= 100
    and char_length(furigana) <= 100
    and char_length(display_name) <= 100
    and (free_text is null or char_length(free_text) <= 2000)
    and pg_column_size(custom_field_values) <= 20000
  );
```

`apps/backend/src/lib/mail-html.ts`(新規)

```typescript
/**
 * スタッフが書いた一斉メール本文を、安全なタグだけに絞る。
 *
 * 地域スタッフのアカウントが 1 つ侵害されると、検証済みの送信ドメインから
 * 担当大会の参加者全員へ任意の HTML を送れてしまう。許可リスト方式にして、
 * リンク先のスキームも制限する。
 */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a']);
const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeMailHtml(html: string): string {
  /* 許可タグ以外は除去、a は href のスキームを検査してから残す */
}
```

`apps/frontend/static/robots.txt`(改修)

```
User-agent: *
# 公開エントリーリストと各大会のフォームはクロールされてよい。
# 以下はログインが要るか、ワンタイムトークン付き URL を踏むページなので除く。
Disallow: /mypage
Disallow: /staff
Disallow: /admin
Disallow: /verify
Disallow: /password-reset
```

#### テスト

* In `packages/shared/src/schemas/entry.test.ts`
  * `EntryInputSchema rejects a name over the maximum length`
  * `EntryInputSchema rejects free text over the maximum length`
  * `EntryInputSchema rejects custom field answers over the combined maximum`
* In `apps/backend/src/lib/db-schema.test.ts`
  * `entries rejects an over-long display_name`
* In `apps/backend/src/lib/mail-html.test.ts`
  * `sanitizeMailHtml strips a script tag`
  * `sanitizeMailHtml strips an event handler attribute`
  * `sanitizeMailHtml drops a javascript: link but keeps an https: one`
  * `sanitizeMailHtml keeps the allowed formatting tags`
* In `apps/backend/src/routes/tournaments.test.ts`
  * `POST /tournaments does not leak the raw database message on a constraint violation`

#### 依存タスク

* Task 3-3, Task 6-3
