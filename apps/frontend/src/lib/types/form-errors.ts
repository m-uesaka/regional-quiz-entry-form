/**
 * Per-field validation messages, keyed by the control's name. Spelled out as
 * a record (rather than left as Zod's per-schema shape) so every failure an
 * action returns carries the same type and the page can index it by a
 * control's name without narrowing across the action's result union.
 */
export type FieldErrors = Record<string, string[] | undefined>;
