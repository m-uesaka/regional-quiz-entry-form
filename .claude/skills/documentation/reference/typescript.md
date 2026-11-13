# TypeScript, JavaScript, and Svelte doc comments

These rules add to the common rules in [`../SKILL.md`](../SKILL.md). For
comment syntax in general (`/** */` versus `//`), the `google-ts-style` skill
is the standard.

## Format

- Write doc comments as TSDoc in a `/** ... */` block placed directly above
  the declaration, above any decorator.
- Use `//` for implementation notes. They are not doc comments.
- Stick to the line length limit of the project's formatter. Use 80
  characters when the project sets none.
- Write each tag on its own line.

## What to document

- Document every named declaration: functions, classes, methods, properties,
  interfaces and their fields, type aliases, enums, and module-level
  constants.
- An inline callback or a local arrow function needs no doc comment.
- In a Svelte component, document each field of the props type. Describe the
  component itself in a `<!-- @component ... -->` comment at the top of the
  markup.

## Tags

- `@param name - Description.` for every parameter.
  - For a destructured object parameter, document each property as
    `@param options.name - Description.`
- `@returns Description.` unless the function returns `void` or
  `Promise<void>`.
- `@throws {ErrorClass} Description.` for every exception the function
  throws, and for every rejection of the promise it returns.
- `@typeParam T - Description.` when the meaning of a type parameter is not
  obvious.
- `@deprecated Description.` with the replacement to use.
- Do not write types in `@param` or `@returns`, i.e. no `{string}`. The
  signature already states them. `@throws` is the exception, because the
  signature does not state the error class.
- Do not write default values, and do not use `@default` for a value that the
  signature shows.
- Do not use tags that repeat a TypeScript keyword: `@private`, `@readonly`,
  `@override`, `@implements`, `@enum`, `@type`.
- In a plain JavaScript file with no type annotations, the types go in the
  JSDoc tags (`@param {string} name - Description.`), because there is no
  signature to state them.

```ts
/**
 * Find a user by ID.
 *
 * @param userId - ID of the user to find.
 * @param options.includeDeleted - Whether to search deleted users too.
 * @returns The user that has the given ID.
 * @throws {UserNotFoundError} User not found.
 */
export async function findUser(
  userId: string,
  { includeDeleted = false }: FindUserOptions = {},
): Promise<User> {
  // ...
}
```

## Parent and child class

- The same rule applies to an interface that extends another one.
- For an overridden method whose contract is unchanged, write only
  `/** {@inheritDoc Parent.methodName} */`.

```ts
/** <Explanation> */
class Parent {
  /** Some explanation. */
  parameterParent: string;
}

/**
 * <Explanation>
 *
 * Also see the doc comment of {@link Parent} about inherited members.
 */
class Child extends Parent {
  /** Some explanation. */
  parameterChild: string;
}
```
