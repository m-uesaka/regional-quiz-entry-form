import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  PasswordResetConfirmInputSchema,
  PasswordResetRequestInputSchema,
  type PasswordResetRequestInput,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {internalError} from '../lib/errors';
import {
  confirmPasswordReset,
  requestPasswordReset,
} from '../lib/password-reset';
import {clientIp, emailKey, rateLimit} from '../middleware/rate-limit';
import {requireTurnstile} from '../middleware/turnstile';

// Matches the period both mail-trigger limiters count over
// (`wrangler.toml`).
const MAIL_TRIGGER_LIMIT_PERIOD_SECONDS = 60;

export const passwordResetRoute = new Hono<Env>()
  .post(
    '/request',
    // The same defences as the entry endpoint, for the same reason: this is
    // the other unauthenticated call that mails an address of the caller's
    // choosing. `/confirm` below needs neither -- it is reached only with a
    // token that was mailed to the account's own address, and it sends
    // nothing.
    rateLimit(
      env => env.MAIL_TRIGGER_IP_RATE_LIMITER,
      c => `ip:${clientIp(c)}`,
      MAIL_TRIGGER_LIMIT_PERIOD_SECONDS,
    ),
    requireTurnstile(),
    zValidator('json', PasswordResetRequestInputSchema),
    rateLimit<{out: {json: PasswordResetRequestInput}}>(
      env => env.MAIL_TRIGGER_EMAIL_RATE_LIMITER,
      c => emailKey(c.req.valid('json').email),
      MAIL_TRIGGER_LIMIT_PERIOD_SECONDS,
    ),
    c => {
      // Handed to `waitUntil()` rather than awaited: an identical body isn't
      // enough to keep this endpoint from enumerating participant emails if
      // the response time still gives the answer away. A registered address
      // costs a token insert and an awaited Resend call -- typically hundreds
      // of milliseconds -- that an unregistered one doesn't, so answering
      // before any of that runs is what actually makes the two cases
      // indistinguishable. Nothing about the outcome is reported anyway (see
      // `requestPasswordReset`), so there is nothing to wait for.
      c.executionCtx.waitUntil(
        requestPasswordReset(c.env, c.req.valid('json').email),
      );
      return c.json({ok: true});
    },
  )
  .post(
    '/confirm',
    zValidator('json', PasswordResetConfirmInputSchema),
    async c => {
      const result = await confirmPasswordReset(c.env, c.req.valid('json'));
      if (!result.ok) {
        if (result.status === 500) {
          return c.json(
            internalError('failed to confirm the password reset', result.error),
            500,
          );
        }
        return c.json({error: result.error}, result.status);
      }
      return c.json({ok: true});
    },
  );
