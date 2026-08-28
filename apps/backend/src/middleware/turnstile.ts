import {createMiddleware} from 'hono/factory';
import type {Env} from '../types/env';
import {verifyTurnstile} from '../lib/turnstile';

/**
 * The header the token travels in.
 *
 * Turnstile's widget writes its token into a form control of this name, and
 * that is where `apps/frontend` reads it from -- but the submission reaches
 * this API as JSON built by the SvelteKit action, not as the browser's form
 * body. Carrying it as a header rather than as a body field keeps it out of
 * the request schemas in `packages/shared`, which describe the entry itself
 * and are also what the mypage edit form and the database insert are built
 * from; a proof-of-humanity that is spent the moment it is checked has no
 * business in any of those.
 */
export const TURNSTILE_TOKEN_HEADER = 'cf-turnstile-response';

/**
 * Refuses a request that doesn't carry a valid Turnstile token.
 *
 * Sits in front of the two endpoints that send mail to an address chosen by
 * whoever is calling (entry registration and the password-reset request),
 * where a script running them in a loop bombards a third party's inbox and
 * burns the mail provider's quota and the sending domain's reputation. Both
 * are things a genuine participant does once, so the friction lands almost
 * entirely on the attacker.
 *
 * A missing and an invalid token are answered the same way (400): the caller
 * fixes both by solving the widget again, and the difference is of interest
 * only to someone probing what gets through.
 */
export function requireTurnstile() {
  return createMiddleware<Env>(async (c, next) => {
    const token = c.req.header(TURNSTILE_TOKEN_HEADER);
    if (!token) {
      return c.json({error: 'turnstile verification failed'}, 400);
    }
    if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, token))) {
      return c.json({error: 'turnstile verification failed'}, 400);
    }
    await next();
  });
}
