/**
 * @fileoverview The check every free-form string written to the database
 * goes through: it has to be well-formed UTF-16 (#298).
 *
 * A lone surrogate -- half of a pair, as `"\ud800"` in a JSON body decodes
 * to -- is not text. PostgREST hands the value to Postgres as JSON, which
 * refuses it, so a field without this check answers a 500 instead of a
 * field error. A paired surrogate (an emoji, or a kanji outside the BMP
 * such as 𠮷) is one code point to a `u` regex and passes.
 */

import type {z} from 'zod';

const LONE_SURROGATE = /\p{Cs}/u;

/** What a string refused for a lone surrogate is told, under its label. */
export function loneSurrogateMessage(label: string): string {
  return `${label}に使用できない文字が含まれています`;
}

/**
 * Whether `value` holds no lone surrogate.
 * @param value The string to check.
 */
export function isWellFormedText(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

/**
 * Refines `schema` to refuse a lone surrogate, with the message
 * `loneSurrogateMessage(label)`.
 * @param schema The string schema to refine.
 * @param label The field's Japanese name, as the message calls it.
 */
export function wellFormedText<T extends z.ZodTypeAny>(
  schema: T,
  label: string,
): z.ZodEffects<T> {
  return schema.refine(
    value => typeof value !== 'string' || isWellFormedText(value),
    {message: loneSurrogateMessage(label)},
  );
}
