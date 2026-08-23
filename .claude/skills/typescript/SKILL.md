---
name: typescript
description: "TypeScript type definition and best-practices skill. Use when: (1) writing or editing TypeScript files (.ts, .tsx), (2) defining types (interface, type), (3) configuring tsconfig.json or compiler options, (4) resolving type errors or improving type safety, (5) working with generics, utility types, or type manipulation, (6) tasks involving the keywords 'typescript', 'ts', 'type', 'interface', 'generic'."
license: MIT
compatibility: Requires TypeScript compiler (tsc)
metadata:
  author: DaleStudy
  version: "1.0.0"
---

# TypeScript

Type definitions and best practices based on the TypeScript Handbook. For basic syntax, type manipulation, and utility type details, see [references/](references/) and the [Handbook](https://www.typescriptlang.org/docs/handbook/intro.html).

## Core principles

### 1. Rely on type inference

Omit unnecessary annotations. This reduces the burden of updating two places when a type changes, and inference is often more accurate anyway.

```typescript
// ❌
const name: string = "John";
const user: { name: string; age: number } = { name: "John", age: 30 };

// ✅
const name = "John";
const user = { name: "John", age: 30 };
```

### 2. Explicit return types

Makes the function's contract clear and prevents accidental changes to the return type. Essential for public APIs and complex logic.

```typescript
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
async function fetchUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

### 3. Never use `any`

It disables type safety and autocompletion. Use `unknown` with a type guard, or a concrete type, instead.

```typescript
// ❌
function process(data: any) {
  return data.value;
}

// ✅
function process(data: unknown): number {
  if (typeof data === "object" && data !== null && "value" in data)
    return (data as { value: number }).value;
  throw new Error("Invalid data");
}
```

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

- **Prefer `interface`**: use `interface` for object contracts/extension, `type` for unions/intersections. Write API doc comments as noun phrases (`/** Disabled state */`).
- **`as const`**: preserves literal/object immutability. Use `typeof obj[keyof typeof obj]` to get enum-like behavior.
- **Branded types**: `type UserId = string & { readonly brand: unique symbol }` to distinguish otherwise-identical primitive types.
- **Minimize type assertions**: prefer a type guard over `as`.
- **Generic constraints**: state them explicitly, e.g. `T extends object`.

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
