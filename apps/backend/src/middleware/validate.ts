import {zValidator} from '@hono/zod-validator';
import {COMMON_ERROR_CODES} from '@regional-quiz/shared';
import type {ValidationTargets} from 'hono';
import type {ZodTypeAny} from 'zod';

/**
 * `zValidator()` answering a failure the way the rest of the API answers a
 * refusal: 400 `{error: 'invalid request'}` (#294). Without a hook,
 * `@hono/zod-validator` answers `{success: false, error: ZodError}`, whose
 * `error` is an object where every other error body has a string, so a
 * caller reading the code from `error` got something it could not match.
 *
 * Use this in place of `zValidator()` in every route. The issues stay out of
 * the response: the frontend checks the same `packages/shared` schemas before
 * it calls, and a body that still fails here is one it did not build.
 * @param target Which part of the request to check.
 * @param schema The schema it has to satisfy.
 * @template T The schema's type.
 * @template Target The part of the request.
 */
export function validate<
  T extends ZodTypeAny,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({error: COMMON_ERROR_CODES.INVALID_REQUEST}, 400);
    }
    return undefined;
  });
}
