# Naming

- `UpperCamelCase`: classes, interfaces, type aliases, enums, decorators, type parameters.
- `lowerCamelCase`: variables, parameters, functions, methods, properties, module aliases.
- `CONSTANT_CASE`: module-level constants and enum values only (not local variables, not fields re-instantiated per object — those are `lowerCamelCase` even if never reassigned).
- **MUST NOT** use leading/trailing `_` (including for "unused" params — use positional omission or `_` alone is also disallowed; just don't rely on the prefix convention).
- **MUST NOT** prefix optional params with `opt_`, or interfaces with `I`.
- Treat acronyms as words: `loadHttpUrl`, not `loadHTTPURL`.
- Prefer descriptive names; short (single-letter) names are only acceptable for a variable scoped to ~10 lines or fewer.

# Comments

- **MUST** use `/** JSDoc */` for documentation meant for callers/readers of an API; use `//` line comments for implementation notes.
- **MUST NOT** use `/* ... */` block-style for multi-line implementation comments — stack multiple `//` lines instead.
- JSDoc tags like `@param` **MUST** each be on their own line.
