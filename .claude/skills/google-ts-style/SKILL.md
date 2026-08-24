---
name: google-ts-style
description: This project's TypeScript coding standard (Google TypeScript Style Guide, https://google.github.io/styleguide/tsguide.html). Load ONCE per writing/editing/review task (never per file, never re-load mid-task) for any .ts/.tsx/.svelte.ts code in apps/backend or apps/frontend. This file is a short index — after loading it, Read only the reference/*.md file(s) that match what you're actually touching, not all of them.
---

# Google TypeScript Style Guide (project standard)

This repo follows the Google TypeScript Style Guide for all TypeScript code, in both `apps/backend` and `apps/frontend`. The authoritative source is https://google.github.io/styleguide/tsguide.html — consult it directly for anything not covered or ambiguous here.

Rules are marked **MUST** (hard rule, flag every violation), **SHOULD** (strong default, deviate only with a good reason), **MUST NOT** (hard prohibition).

**Token budget: this index + the "already enforced" section below is the only part meant to be read every time.** The detailed rules live in `reference/` as one file per topic — pull only the file(s) relevant to the code you're about to write/review this task, not the whole set. If a task touches several topics, batch-read only those specific files in one go rather than reading the whole directory.

## Already enforced by `gts` — don't re-derive these manually

This repo runs `gts lint` / `gts fix` (ESLint + Prettier, configured in every package's `eslint.config.cjs`) in CI and via each package's `lint`/`fix` script. Verified empirically against this repo's `gts@7` config — it auto-detects/auto-fixes:

- Single-quote strings and general formatting (Prettier)
- `var` usage (`no-var`) and `let`/`var` that's never reassigned (`prefer-const`)
- `==`/`!=` instead of `===`/`!==` (`eqeqeq`)
- `switch` case fallthrough (`no-fallthrough`)
- The `Array()` constructor (`no-array-constructor`)

Don't spend review/writing effort manually re-checking these — run `bun run lint` (or the package's `gts fix`) instead. Everything in the reference files below is **not** caught by lint (confirmed by testing this repo's config against sample violations) — it needs actual judgment, so this is where review attention belongs.

## Topic index — read only what you need

| If you're touching...                                   | Read                                          |
| --------------------------------------------------------- | ---------------------------------------------- |
| `import`/`export` statements                              | `reference/imports-exports.md`                |
| variable declarations, arrays, objects, destructuring     | `reference/variables-arrays-objects.md`       |
| `class` bodies, constructors, fields, decorators           | `reference/classes-decorators.md`             |
| function/arrow declarations, callbacks, `this`             | `reference/functions-this.md`                 |
| strings, number parsing, `==`/`===`, coercion              | `reference/primitives-equality.md`            |
| `if`/`for`/`switch`/`try`/`catch`/throwing errors          | `reference/control-flow-exceptions.md`        |
| type annotations, `interface`/`type`, `any`/`unknown`, `as` | `reference/type-system.md`                    |
| identifier naming, JSDoc/comments                          | `reference/naming-comments.md`                |

A full review (e.g. reviewing an entire PR diff) will likely end up reading most or all of these once — that's fine, it's still one read each, not one per file changed. A narrow task (e.g. "add one new Zod-validated route") typically only needs 2-3 of them.

## How to apply this during implementation

When writing backend (Hono) or frontend (SvelteKit) TypeScript, follow the rules in the relevant reference file(s) directly. Framework idioms take precedence where they genuinely conflict (e.g. SvelteKit file-based routing naturally uses default exports for `load`/`+page.svelte` — that's a framework requirement, not a violation of the "no default export" rule, which is about your own module APIs).

## How to apply this during code review

Flag violations the same way as correctness bugs: cite the concrete rule broken (MUST vs SHOULD), the file/line, and what to change. Do not flag framework-mandated exceptions (see above) as violations. Prioritize MUST violations; SHOULD violations are worth noting but are not blocking on their own unless they indicate a real bug risk (e.g. `any` hiding a type error, `==` masking a coercion bug).
