---
name: google-ts-style
description: This project's TypeScript coding standard (Google TypeScript Style Guide, https://google.github.io/styleguide/tsguide.html). MUST be loaded whenever writing, editing, or reviewing any .ts/.tsx/.svelte.ts file in this repo — both apps/backend (Hono) and apps/frontend (SvelteKit). Use for code review checks and when unsure how to format/name/structure TypeScript code.
---

# Google TypeScript Style Guide (project standard)

This repo follows the Google TypeScript Style Guide for all TypeScript code, in both `apps/backend` and `apps/frontend`. This file is a condensed, rule-oriented summary for day-to-day writing and review; the authoritative source is https://google.github.io/styleguide/tsguide.html — consult it directly for anything not covered or ambiguous here.

Rules are marked **MUST** (hard rule, flag every violation), **SHOULD** (strong default, deviate only with a good reason), **MUST NOT** (hard prohibition).

## Already enforced by `gts` — don't re-derive these manually

This repo runs `gts lint` / `gts fix` (ESLint + Prettier, configured in every package's `eslint.config.cjs`) in CI and via each package's `lint`/`fix` script. Verified empirically against this repo's `gts@7` config — it auto-detects/auto-fixes:

- Single-quote strings and general formatting (Prettier)
- `var` usage (`no-var`) and `let`/`var` that's never reassigned (`prefer-const`)
- `==`/`!=` instead of `===`/`!==` (`eqeqeq`)
- `switch` case fallthrough (`no-fallthrough`)
- The `Array()` constructor (`no-array-constructor`)

Don't spend review/writing effort manually re-checking these — run `bun run lint` (or the package's `gts fix`) instead. Everything below this section is **not** caught by lint (confirmed by testing this repo's config against sample violations) — it needs actual judgment, so this is where review attention belongs.

## Imports & exports

- **MUST** use ES6 `import`/`export` only. Never `require()` or `namespace Foo {}`.
- **MUST** use **named exports only** — never `export default`.
- **MUST NOT** use mutable exports (`export let foo`). Export a getter function instead.
- **MUST NOT** create container classes with only static members for namespacing — use plain module-level `export const`/`export function`.
- **SHOULD** use relative imports within the project.
- **SHOULD** use named imports for a few symbols; namespace imports (`import * as foo`) for large/many-symbol APIs.
- `import type {...}` / `export type {...}` **MAY** be used for type-only imports/re-exports.

## Variables

- **MUST** use `const` by default, `let` if reassigned, **never `var`**.
- **MUST NOT** declare multiple variables in one statement (`const a = 1, b = 2;` is wrong).
- **MUST NOT** use a variable before its declaration.

## Arrays & objects

- **MUST NOT** use the `Array()` or `Object()` constructors — use literals (`[]`, `{}`).
- **MUST NOT** add non-numeric properties to arrays — use `Map` or a plain object.
- **MUST NOT** use unfiltered `for...in` — use `for...of Object.keys/values/entries(...)`, or filter with `hasOwnProperty`.
- Spread (`...`) is fine for shallow copy/merge: only spread iterables into arrays, only spread objects into objects (never spread `null`/`undefined`/primitives).
- Destructuring: keep it to one level, shorthand properties, defaults on the left (`{num, str = 'default'}`).

## Classes

- **MUST NOT** terminate a `class` declaration with `;`; class *expressions* assigned to a variable do need one.
- **MUST NOT** put `;` between method declarations; separate methods with one blank line.
- **MUST NOT** use `#private` fields — use the `private` modifier instead.
- **MUST NOT** use `this` in a static method/context — reference the class name directly.
- **MUST NOT** rely on dynamic dispatch of static methods (don't call a static method on a subclass).
- **MUST** call constructors with parentheses: `new Foo()`, never `new Foo`.
- Omit the constructor entirely if it would be empty with no modifiers/decorators/parameter properties.
- **SHOULD** use constructor parameter properties (`constructor(private readonly svc: Svc) {}`) instead of manually assigning `this.x = x`.
- **SHOULD** mark fields never reassigned outside the constructor `readonly`.
- Never use the `public` modifier except on a non-readonly constructor parameter property.
- Getters/setters are fine, but a getter must be a pure, side-effect-free function, and at least one accessor in a pair must do non-trivial work (no pure pass-through get/set pairs).

## Functions & `this`

- **SHOULD** prefer named `function` declarations over arrow functions/function expressions for top-level/named functions.
- **MUST NOT** use anonymous `function` expressions as callbacks — use arrow functions instead (exceptions: dynamic `this` rebinding, generators).
- **SHOULD NOT** use arrow functions as class fields (obscures `this` binding) — exception: event-handler fields that need a stable reference for add/removeEventListener.
- **MUST NOT** use `bind()` when installing an event handler (can't be uninstalled).
- **MUST** only use `this` inside class constructors/methods, functions with an explicit `this` parameter type, or arrow functions in a scope where `this` is meaningful.
- **SHOULD** use rest parameters (`...args`) instead of `arguments`; never name a variable `arguments`.
- Default parameter initializers must be simple and side-effect-free.

## Primitives, coercion, equality

- **MUST** use single quotes `'...'` for string literals, not double quotes.
- **SHOULD** use template literals over string concatenation when it's not trivial.
- **MUST NOT** use line-continuation backslashes in string literals.
- **MUST** use `===`/`!==`; **never** `==`/`!=` — except `== null` / `!= null`, which is the idiomatic way to test for both `null` and `undefined` at once.
- **MUST NOT** implicitly or explicitly coerce enum values with `Boolean()`/`!!` — compare explicitly (`level !== SupportLevel.NONE`).
- **MUST** use `Number(x)` to parse numbers and check `isNaN`/`isFinite`; **MUST NOT** use unary `+` to coerce, and **MUST NOT** use `parseInt`/`parseFloat` except for non-base-10 radixes (with input validated first).
- **MUST NOT** instantiate wrapper objects (`new String(...)`, `new Boolean(...)`, `new Number(...)`).

## Control flow, exceptions

- `if`/`for`/`while`/`do` **MUST** use braced blocks (single-line `if` may elide braces).
- **SHOULD** avoid assignment inside a condition; if unavoidable, wrap in extra parens: `while ((x = next()))`.
- **SHOULD** prefer `for (const x of arr)` over index-based loops; **MUST NOT** use `for...in` over arrays.
- Every `switch` **MUST** have a `default` clause (last, even if empty/`// nothing to do`); non-empty `case` bodies **MUST NOT** fall through (empty ones may).
- **MUST** throw `new Error(...)` (or a subclass) — never throw a string or other non-Error value.
- In `catch (e: unknown)`, assume `e` may not be an `Error`; check with `instanceof Error` before using `.message`, unless the API is known to throw non-Errors (leave a comment explaining why).
- Empty `catch` blocks **MUST** have a comment explaining why nothing happens.
- Keep `try` blocks small — wrap only the call(s) that can actually throw, not unrelated surrounding code (loops are an accepted exception for performance).

## Type system

- **SHOULD NOT** use `any` — prefer a real type, or `unknown` narrowed with a type guard. If `any` is genuinely required, add a lint-suppression comment explaining why.
- **SHOULD** rely on inference for trivial types (`const x = 15`); add explicit annotations for object literals assigned to a named type (`const foo: Foo = {...}`, not `as Foo`) and where inference would otherwise land on `unknown`.
- **SHOULD** use `interface` (not `type`) for object/structural shapes; reserve `type` for unions, tuples, function types, and mapped/conditional types.
- **SHOULD** use `T[]` / `readonly T[]` for simple element types, `Array<T>` only when `T` itself is a union or otherwise non-trivial.
- Type aliases **MUST NOT** bake `| null`/`| undefined` into the alias itself — add nullability at the point of use.
- **SHOULD** prefer optional properties/params (`field?: T`) over `field: T | undefined`.
- **SHOULD NOT** use `any`/`{}` for "arbitrary object" — use `unknown` (opaque value), `Record<string, T>` (dict), or `object` (non-primitive) as appropriate.
- "Always use the simplest type construct that expresses the code" — prefer a plain `interface` extending another over a clever `Pick<T, 'a'|'b'>`/mapped type when both are equally clear.
- Type assertions (`x as T`) and non-null assertions (`y!`) are unsafe (no runtime check) — prefer a real runtime check (`instanceof`, `typeof`, truthiness). If an assertion is genuinely known-safe, add a comment saying why. Always use `as T`, never `<T>x`.

## Naming

- `UpperCamelCase`: classes, interfaces, type aliases, enums, decorators, type parameters.
- `lowerCamelCase`: variables, parameters, functions, methods, properties, module aliases.
- `CONSTANT_CASE`: module-level constants and enum values only (not local variables, not fields re-instantiated per object — those are `lowerCamelCase` even if never reassigned).
- **MUST NOT** use leading/trailing `_` (including for "unused" params — use positional omission or `_` alone is also disallowed; just don't rely on the prefix convention).
- **MUST NOT** prefix optional params with `opt_`, or interfaces with `I`.
- Treat acronyms as words: `loadHttpUrl`, not `loadHTTPURL`.
- Prefer descriptive names; short (single-letter) names are only acceptable for a variable scoped to ~10 lines or fewer.

## Comments

- **MUST** use `/** JSDoc */` for documentation meant for callers/readers of an API; use `//` line comments for implementation notes.
- **MUST NOT** use `/* ... */` block-style for multi-line implementation comments — stack multiple `//` lines instead.
- JSDoc tags like `@param` **MUST** each be on their own line.

## Decorators

- **MUST NOT** author new decorators in this codebase — only use decorators provided by a framework already in use (if any).

## How to apply this during implementation

When writing backend (Hono) or frontend (SvelteKit) TypeScript, follow the rules above directly. Framework idioms take precedence where they genuinely conflict (e.g. SvelteKit file-based routing naturally uses default exports for `load`/`+page.svelte` — that's a framework requirement, not a violation of the "no default export" rule, which is about your own module APIs).

## How to apply this during code review

Flag violations the same way as correctness bugs: cite the concrete rule broken (MUST vs SHOULD), the file/line, and what to change. Do not flag framework-mandated exceptions (see above) as violations. Prioritize MUST violations; SHOULD violations are worth noting but are not blocking on their own unless they indicate a real bug risk (e.g. `any` hiding a type error, `==` masking a coercion bug).
