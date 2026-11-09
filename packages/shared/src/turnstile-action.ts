/**
 * The `action` the Turnstile widget is rendered with on each form, and so
 * what the endpoint the form is submitted to expects of the token (#297).
 * Shared so the widget and the API name a form the same way. Turnstile takes
 * up to 32 letters, digits, `_` and `-`.
 */
export const TURNSTILE_ACTIONS = {
  /** The entry form, anonymous or logged in. */
  ENTRY: 'entry',
  /** A participant asking for a password reset link. */
  PASSWORD_RESET: 'password-reset',
  /** A staff member asking for a password reset link. */
  STAFF_PASSWORD_RESET: 'staff-password-reset',
} as const;

/** One of `TURNSTILE_ACTIONS`. */
export type TurnstileAction =
  (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
