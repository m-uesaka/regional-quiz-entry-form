# Primitives, coercion, equality

- **MUST** use single quotes `'...'` for string literals, not double quotes.
- **SHOULD** use template literals over string concatenation when it's not trivial.
- **MUST NOT** use line-continuation backslashes in string literals.
- **MUST** use `===`/`!==`; **never** `==`/`!=` — except `== null` / `!= null`, which is the idiomatic way to test for both `null` and `undefined` at once.
- **MUST NOT** implicitly or explicitly coerce enum values with `Boolean()`/`!!` — compare explicitly (`level !== SupportLevel.NONE`).
- **MUST** use `Number(x)` to parse numbers and check `isNaN`/`isFinite`; **MUST NOT** use unary `+` to coerce, and **MUST NOT** use `parseInt`/`parseFloat` except for non-base-10 radixes (with input validated first).
- **MUST NOT** instantiate wrapper objects (`new String(...)`, `new Boolean(...)`, `new Number(...)`).
