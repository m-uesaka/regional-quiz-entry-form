---
name: typescript
description: "Deep-dive TypeScript reference for generic constraints, type guards, tsconfig.json setup, DOM/React event types, branded/utility types, and resolving a specific tsc compiler error message. Do NOT use this for everyday TypeScript style or conventions in this repo (exports, naming, any/unknown, interface-vs-type, etc.) — that's covered by the `google-ts-style` skill, which is the project's actual standard."
license: MIT
compatibility: Requires TypeScript compiler (tsc)
metadata:
  author: DaleStudy
  version: "1.0.0"
---

# TypeScript

Type definitions and best practices based on the TypeScript Handbook, for the topics this skill covers (generics, type guards, tsconfig, event/utility/branded types, compiler-error resolution). For this project's day-to-day style rules (imports/exports, naming, `any`/`unknown`, `interface` vs `type`, etc.), see the `google-ts-style` skill instead — it is the project standard and takes precedence over anything here. For basic syntax and type manipulation not covered by either skill, see [references/](references/) and the [Handbook](https://www.typescriptlang.org/docs/handbook/intro.html).

## Functions & generics

- Functions: annotate argument and return types explicitly. For overloads, give the implementation signature a union type.
- Generics: state constraints explicitly, e.g. `T`, `K extends keyof T`. Use patterns like `getProperty<T, K extends keyof T>(obj: T, key: K): T[K]`.

## Type guards

- Narrow types by branching on `typeof`, `instanceof`, `in`.
- For complex checks, use a user-defined guard: `(value): value is T`.

> Template: `assets/types.guards.ts`

## tsconfig

- Use a tsconfig suited to the kind of project.
- Only relax options as far as it doesn't compromise type safety.
- Keep separate config files for apps/servers/libraries.
- Never loosen an option just to dodge a type error.

> Templates:
>
> - `assets/tsconfig.nextjs.ts`
> - `assets/tsconfig.node.ts`
> - `assets/tsconfig.react.ts`

## Event types

- Use the built-in types for DOM / React events.
- Only define separate types for custom events.
- Never redefine an existing event type.

> Template: `assets/types.events.ts`

## Utility types

- Use TypeScript's built-in utility types as-is.
- Only define custom utility types for what's missing.

> Template: `assets/types.utils.ts`

## Practical patterns

- **`as const`**: preserves literal/object immutability. Use `typeof obj[keyof typeof obj]` to get enum-like behavior.
- **Branded types**: `type UserId = string & { readonly brand: unique symbol }` to distinguish otherwise-identical primitive types.

## Resolving type errors

| Error                                                              | Fix                                    |
| ------------------------------------------------------------------- | --------------------------------------- |
| `Type 'X' is not assignable to type 'Y'`                          | Branch with a type guard before assigning |
| `Property 'X' does not exist on type 'Y'`                         | Extend the type, or mark it `optional`  |
| `Object is possibly 'null' or 'undefined'`                        | `if (x == null)` / `?.` / `??`          |
| `Argument of type 'X' is not assignable to parameter of type 'Y'` | Generic `T[]`, or an overload           |
| `Type 'X' cannot be used as an index type`                        | Use `keyof typeof obj`                  |

Debugging: hover to check inferred types; resolve with guards, generics, and utility types first — `as` is a last resort.

## References

> These documents are references, not rules — defer to the judgment set out in each skill document.

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — official reference for TypeScript concepts and the type system
- [Playground](https://www.typescriptlang.org/play) — for experimenting with type behavior and validating examples
