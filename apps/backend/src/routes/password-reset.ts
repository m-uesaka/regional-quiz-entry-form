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
        return c.json({error: result.error}, result.status);
      }
      return c.json({ok: true});
    },
  );
