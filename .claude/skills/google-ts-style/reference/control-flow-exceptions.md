# Control flow, exceptions

- `if`/`for`/`while`/`do` **MUST** use braced blocks (single-line `if` may elide braces).
- **SHOULD** avoid assignment inside a condition; if unavoidable, wrap in extra parens: `while ((x = next()))`.
- **SHOULD** prefer `for (const x of arr)` over index-based loops; **MUST NOT** use `for...in` over arrays.
- Every `switch` **MUST** have a `default` clause (last, even if empty/`// nothing to do`); non-empty `case` bodies **MUST NOT** fall through (empty ones may).
- **MUST** throw `new Error(...)` (or a subclass) — never throw a string or other non-Error value.
- In `catch (e: unknown)`, assume `e` may not be an `Error`; check with `instanceof Error` before using `.message`, unless the API is known to throw non-Errors (leave a comment explaining why).
- Empty `catch` blocks **MUST** have a comment explaining why nothing happens.
- Keep `try` blocks small — wrap only the call(s) that can actually throw, not unrelated surrounding code (loops are an accepted exception for performance).
