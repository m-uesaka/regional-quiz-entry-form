# Variables

- **MUST** use `const` by default, `let` if reassigned, **never `var`**.
- **MUST NOT** declare multiple variables in one statement (`const a = 1, b = 2;` is wrong).
- **MUST NOT** use a variable before its declaration.

# Arrays & objects

- **MUST NOT** use the `Array()` or `Object()` constructors — use literals (`[]`, `{}`).
- **MUST NOT** add non-numeric properties to arrays — use `Map` or a plain object.
- **MUST NOT** use unfiltered `for...in` — use `for...of Object.keys/values/entries(...)`, or filter with `hasOwnProperty`.
- Spread (`...`) is fine for shallow copy/merge: only spread iterables into arrays, only spread objects into objects (never spread `null`/`undefined`/primitives).
- Destructuring: keep it to one level, shorthand properties, defaults on the left (`{num, str = 'default'}`).
