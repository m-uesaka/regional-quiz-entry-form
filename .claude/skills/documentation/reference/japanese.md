# Writing in Japanese

These rules apply whenever the documentation is written in Japanese: doc
comments, code comments, the documentation in `docs/`, and the documents that
a skill outputs. They add to the common rules in
[`../SKILL.md`](../SKILL.md). The examples are in Japanese on purpose.

## What stays in English

- Section names and tags that tools parse: `Args:`, `Returns:`, `Raises:`,
  `Attributes:`, `@param`, `@returns`, `@throws`.
- Identifiers, file paths, commands, and the names of libraries and products.
- Exception messages. Copy the message exactly as the code defines it, even
  when the surrounding text is Japanese.

## Style (文体)

| Where | Style |
| --- | --- |
| Doc comments and code comments | 常体 (「〜する」「〜である」) |
| Bullets, table cells, and titles | 常体 or 体言止め |
| Prose in `docs/` and `README` | 敬体 (「〜です」「〜ます」) |

- Keep one style within one document. When the existing text uses another
  style, follow the existing text.
- The imperative mood rule becomes: end the summary line with the dictionary
  form of a verb, and do not name the subject.
  - Good: `ユーザーを ID で検索する。`
  - Bad: `この関数はユーザーを ID で検索します。`
- Describe an argument, a return value, or an attribute with a noun phrase.
  - Good: `user_id: 検索するユーザーの ID。`
- Write one fact per sentence. Split a sentence that joins clauses with
  「〜し、」「〜が、」「〜ので、」「〜ており、」.
- Do not use vague endings such as 「〜など」「〜等」「〜と思われる」 when the
  exact content is known.

## Characters (表記)

- Use half-width characters for alphanumerics, spaces, and the symbols of
  code. Use full-width characters for kana, kanji, and Japanese punctuation.
- Use 「、」 and 「。」 for punctuation. When the existing text uses 「，」 and
  「．」, follow the existing text.
- Use full-width 「（）」 and 「：」 inside Japanese sentences. The colon after
  a section name, a tag, or an argument name stays half-width (`Args:`,
  `user_id:`).
- Put one half-width space between a Japanese character and an adjacent
  half-width word or inline code. Put none next to punctuation or brackets.
  - Good: `ユーザーを ID で検索する。`
- Write katakana loanwords with the long vowel mark: 「ユーザー」「サーバー」
  「コンピューター」「パラメーター」.
- Use one term for one concept in the whole document. Do not switch between
  「引数」 and 「パラメーター」, or between 「返す」 and 「戻す」.
- Use the terms 「引数」「戻り値」「例外」 for the three parts of a function.

## Line length

- A full-width character counts as 2 columns. The 88 column limit is 44
  full-width characters, and the 80 column limit is 40.
- Break a line after 「、」 or 「。」 where possible, never in the middle of a
  word.

## Examples

```python
def find_user(user_id: str, include_deleted: bool = False) -> User:
    """ユーザーを ID で検索する。

    Args:
        user_id: 検索するユーザーの ID。
        include_deleted: 削除済みのユーザーも検索対象に含めるかどうか。

    Returns:
        指定した ID を持つユーザー。

    Raises:
        UserNotFoundError: User not found.
    """
```

```ts
/**
 * ユーザーを ID で検索する。
 *
 * @param userId - 検索するユーザーの ID。
 * @param options.includeDeleted - 削除済みのユーザーも検索対象に
 *   含めるかどうか。
 * @returns 指定した ID を持つユーザー。
 * @throws {UserNotFoundError} User not found.
 */
```

For a child class, point to the parent as follows.

```python
class Child(Parent):
    """<説明>

    継承した属性については親クラスの docstring を参照。

    Attributes:
        parameter_child: <説明>
    """
```
