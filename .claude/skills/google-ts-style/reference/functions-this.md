# Functions & `this`

- **SHOULD** prefer named `function` declarations over arrow functions/function expressions for top-level/named functions.
- **MUST NOT** use anonymous `function` expressions as callbacks — use arrow functions instead (exceptions: dynamic `this` rebinding, generators).
- **SHOULD NOT** use arrow functions as class fields (obscures `this` binding) — exception: event-handler fields that need a stable reference for add/removeEventListener.
- **MUST NOT** use `bind()` when installing an event handler (can't be uninstalled).
- **MUST** only use `this` inside class constructors/methods, functions with an explicit `this` parameter type, or arrow functions in a scope where `this` is meaningful.
- **SHOULD** use rest parameters (`...args`) instead of `arguments`; never name a variable `arguments`.
- Default parameter initializers must be simple and side-effect-free.
