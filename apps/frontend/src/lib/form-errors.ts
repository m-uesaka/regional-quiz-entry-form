/**
 * @fileoverview The wording and values the form actions share when they
 * refuse a submission. The per-field error type itself is in
 * `$lib/types/form-errors`.
 */

import type {FieldErrors} from '$lib/types/form-errors';

/**
 * Nothing to attach per control -- the refusal is about the submission as a
 * whole. One object shared by every action that answers this, so it is
 * frozen: a write into it would otherwise turn up in every later refusal.
 */
export const NO_FIELD_ERRORS: Readonly<FieldErrors> = Object.freeze({});

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
