# Writing rules for generated documents

These rules apply to the Markdown documents that a skill writes as its
output, e.g. a task list, a review report, or a ticket. They do not apply to
docstrings, code comments, or the hand-written documentation under `docs/`.

A skill that refers to these rules states which element of its document is
of which kind below. When the skill gives a stricter limit or an explicit
exemption for an element, the skill wins.

## How a skill adopts these rules

Every skill that writes a document as its output follows these rules. To
make a skill follow them, add the following to the skill.

- A reference to this file by its path from the repository root,
  `.claude/skills/documentation/writing_rules.md`.
  - Do not use a path relative to the skill directory. A skill directory can
    be a symlink, so a relative path may not resolve.
- An instruction to read this file before writing the document.
- The kind of each element of the document.
- The fixed text for a section that can be empty, if the document has one.

A repository that receives such a skill needs the `documentation` skill
too. Add both to `.github/sync.yml`.

## Length limits

| Kind of element | English | Japanese |
| --- | --- | --- |
| Title | 20 words, no trailing period | 40 characters, no trailing 「。」 |
| Short summary | 50 words, one sentence | 100 characters, one sentence |
| Bullet | 30 words, one sentence | 60 characters, one sentence |
| Paragraph | 3 sentences, 30 words each | 3 sentences, 60 characters each |

Write the document in the language chosen by the rule in
[`SKILL.md`](SKILL.md). A document in Japanese also follows
[`reference/japanese.md`](reference/japanese.md).

- **Title**: the document title, a heading, or the title of an item.
- **Short summary**: the one-line summary of an item, e.g. an entry in an
  overview list or the description of a finding.
- **Bullet**: every other list item.
- **Paragraph**: prose outside a list. Write one only where the format of
  the document asks for it.

### How to count words

- A word is a run of characters between spaces.
- An identifier, a path, or a URL in backticks counts as one word, and so
  does a Markdown link.
- Do not count a leading ID, label, or marker, e.g. `Task 1-1:`, `Reason:`,
  an emoji, or a `[Category]` tag.
- Fenced code blocks, diagrams, and tables have no word limit.

### How to count characters in Japanese

- Count every character, including punctuation. A full-width and a
  half-width character each count as one.
- An identifier, a path, or a URL in backticks counts as 2 characters, and
  so does a Markdown link.
- A half-width word outside backticks, e.g. `API` or `TypeScript`, counts as
  2 characters.
- Do not count spaces.
- The exclusions above for English apply too: a leading ID, label, or
  marker, and fenced code blocks, diagrams, and tables.

### When a text is over its limit

- Split it into several bullets, or move the details into nested
  sub-bullets.
- Remove what the reader can already see elsewhere in the document.
- Never drop a fact the document needs in order to meet the limit — split
  instead.

## Structure

- Write bullets, not paragraphs.
- State one fact per bullet. When a sentence needs "and", "which", or a
  second clause, split it. In Japanese, split at 「〜し、」「〜が、」
  「〜ので、」.
- Put the details of a bullet in nested sub-bullets, not in parentheses or
  trailing clauses.
- State the fact itself, not its rationale. Give a reason only when it is
  not obvious, as its own bullet.
- Do not repeat in prose what a code block, a table, or another section
  already shows.
- Refer to code by its identifier in backticks (`ClassName.method_name`,
  `path/to/file.py`, `functionName`, `path/to/file.ts`) instead of
  describing it in words.
- Never leave a section empty or with a placeholder. Omit it, or write the
  fixed text the skill gives for that case.
- Leave a blank line before and after every heading, list, and fenced code
  block.

## Check before finishing

Re-read the written document and fix every element that is over its limit,
every bullet with more than one sentence, and every paragraph the format
does not ask for.
