/**
 * Per-field validation messages, keyed by the control's name. Spelled out as
 * a record (rather than left as Zod's per-schema shape) so every failure an
 * action returns carries the same type and the page can index it by a
 * control's name without narrowing across the action's result union.
 */
export type FieldErrors = Record<string, string[] | undefined>;

/**
 * Nothing to attach per control -- the refusal is about the submission as a
 * whole.
 */
export const NO_FIELD_ERRORS: FieldErrors = {};

/** Shown above a form some of whose controls were refused. */
export const INVALID_INPUT_MESSAGE = '入力内容を確認してください';

/**
 * Shown for a 429 from the API. The rate limits behind it are counted per IP
 * *and* per address (#116), so it can be met by someone who never submitted
 * anything themselves -- from a shared connection, say -- which is why the
 * wording asks for patience rather than blaming the submission.
 */
export const TOO_MANY_REQUESTS_MESSAGE =
  '送信が集中しています。しばらく待ってから再度お試しください';

/** Shown when a new password and its confirmation differ. */
export const PASSWORD_MISMATCH_MESSAGE = 'パスワードが一致しません';
