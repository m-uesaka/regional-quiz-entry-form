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

/**
 * The length of `value` in code points, as the database's `char_length()`
 * counts it (#302). `String.length` counts UTF-16 units instead, so an emoji
 * or a kanji outside the BMP (𠮷) counts twice there, and a name the
 * database would take was refused at about half its limit. A lone
 * surrogate counts as one, as it does to the spread.
 * @param value The string to measure.
 */
export function codePointLength(value: string): number {
  return [...value].length;
}

/**
 * The `maxlength` to put on a control whose value is limited to `limit`
 * code points. A browser counts `maxlength` in UTF-16 units, so the limit
 * itself would stop input of characters outside the BMP at as few as half
 * of them -- the refusal `codePointLength()` is there to remove. Twice the
 * limit is what `limit` code points take at most, so the browser never stops
 * what the schema would accept, and the schema's message names the limit.
 * @param limit The limit in code points.
 */
export function maxLengthAttribute(limit: number): number {
  return limit * 2;
}

/**
 * Refines `schema` to refuse a string longer than `limit` code points
 * (`codePointLength()`), in place of the UTF-16 units `.max()` counts.
 * @param schema The string schema to refine.
 * @param limit The most code points it takes.
 * @param message What a longer string is told.
 */
export function maxCodePoints<T extends z.ZodType<string>>(
  schema: T,
  limit: number,
  message: string,
): z.ZodEffects<T> {
  return schema.refine(value => codePointLength(value) <= limit, {message});
}

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
