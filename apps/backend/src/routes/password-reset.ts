import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  PasswordResetConfirmInputSchema,
  PasswordResetRequestInputSchema,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {
  confirmPasswordReset,
  requestPasswordReset,
} from '../lib/password-reset';

export const passwordResetRoute = new Hono<Env>()
  .post('/request', zValidator('json', PasswordResetRequestInputSchema), c => {
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
  })
  .post(
    '/confirm',
    zValidator('json', PasswordResetConfirmInputSchema),
    async c => {
      const result = await confirmPasswordReset(c.env, c.req.valid('json'));
      if (!result.ok) {
        if (result.status === 500) {
          // This endpoint is unauthenticated, so the Supabase message stays
          // server-side: it describes the database rather than anything the
          // caller can act on.
          console.error('failed to confirm the password reset', {
            error: result.error,
          });
          return c.json({error: 'internal server error'}, 500);
        }
        return c.json({error: result.error}, result.status);
      }
      return c.json({ok: true});
    },
  );
