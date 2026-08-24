# Classes

- **MUST NOT** terminate a `class` declaration with `;`; class *expressions* assigned to a variable do need one.
- **MUST NOT** put `;` between method declarations; separate methods with one blank line.
- **MUST NOT** use `#private` fields — use the `private` modifier instead.
- **MUST NOT** use `this` in a static method/context — reference the class name directly.
- **MUST NOT** rely on dynamic dispatch of static methods (don't call a static method on a subclass).
- **MUST** call constructors with parentheses: `new Foo()`, never `new Foo`.
- Omit the constructor entirely if it would be empty with no modifiers/decorators/parameter properties.
- **SHOULD** use constructor parameter properties (`constructor(private readonly svc: Svc) {}`) instead of manually assigning `this.x = x`.
- **SHOULD** mark fields never reassigned outside the constructor `readonly`.
- Never use the `public` modifier except on a non-readonly constructor parameter property.
- Getters/setters are fine, but a getter must be a pure, side-effect-free function, and at least one accessor in a pair must do non-trivial work (no pure pass-through get/set pairs).

# Decorators

- **MUST NOT** author new decorators in this codebase — only use decorators provided by a framework already in use (if any).
