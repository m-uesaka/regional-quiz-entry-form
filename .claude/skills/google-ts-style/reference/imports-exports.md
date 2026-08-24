# Imports & exports

- **MUST** use ES6 `import`/`export` only. Never `require()` or `namespace Foo {}`.
- **MUST** use **named exports only** — never `export default`.
- **MUST NOT** use mutable exports (`export let foo`). Export a getter function instead.
- **MUST NOT** create container classes with only static members for namespacing — use plain module-level `export const`/`export function`.
- **SHOULD** use relative imports within the project.
- **SHOULD** use named imports for a few symbols; namespace imports (`import * as foo`) for large/many-symbol APIs.
- `import type {...}` / `export type {...}` **MAY** be used for type-only imports/re-exports.
