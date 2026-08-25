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
  .post(
    '/request',
    zValidator('json', PasswordResetRequestInputSchema),
    async c => {
      await requestPasswordReset(c.env, c.req.valid('json').email);
      // The same response whether or not the address is registered, so this
      // endpoint can't be used to enumerate participant emails.
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
