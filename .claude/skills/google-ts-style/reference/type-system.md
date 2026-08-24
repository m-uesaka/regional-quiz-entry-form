# Type system

- **SHOULD NOT** use `any` — prefer a real type, or `unknown` narrowed with a type guard. If `any` is genuinely required, add a lint-suppression comment explaining why.
- **SHOULD** rely on inference for trivial types (`const x = 15`); add explicit annotations for object literals assigned to a named type (`const foo: Foo = {...}`, not `as Foo`) and where inference would otherwise land on `unknown`.
- **SHOULD** use `interface` (not `type`) for object/structural shapes; reserve `type` for unions, tuples, function types, and mapped/conditional types.
- **SHOULD** use `T[]` / `readonly T[]` for simple element types, `Array<T>` only when `T` itself is a union or otherwise non-trivial.
- Type aliases **MUST NOT** bake `| null`/`| undefined` into the alias itself — add nullability at the point of use.
- **SHOULD** prefer optional properties/params (`field?: T`) over `field: T | undefined`.
- **SHOULD NOT** use `any`/`{}` for "arbitrary object" — use `unknown` (opaque value), `Record<string, T>` (dict), or `object` (non-primitive) as appropriate.
- "Always use the simplest type construct that expresses the code" — prefer a plain `interface` extending another over a clever `Pick<T, 'a'|'b'>`/mapped type when both are equally clear.
- Type assertions (`x as T`) and non-null assertions (`y!`) are unsafe (no runtime check) — prefer a real runtime check (`instanceof`, `typeof`, truthiness). If an assertion is genuinely known-safe, add a comment saying why. Always use `as T`, never `<T>x`.
