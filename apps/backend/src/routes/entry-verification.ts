import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import type {Env} from '../types/env';
import {confirmEntryByToken} from '../lib/entry-confirmation';
import {internalError} from '../lib/errors';

export const entryVerificationRoute = new Hono<Env>().get(
  '/verify',
  zValidator('query', z.object({token: z.string().min(1)})),
  async c => {
    const result = await confirmEntryByToken(c.env, c.req.valid('query').token);
    if (!result.ok) {
      // Only a token the database actually refused is reported as a client
      // error: a 400 is what tells the participant their link is dead and
      // that they should enter again, and saying that after a transient
      // Supabase failure would strand an entry that is still
      // `pending_verification` (a re-entry is refused as a duplicate).
      if (result.reason === 'invalid_token') {
        return c.json({error: result.error}, 400);
      }
      // Anything else is a Supabase message about the database, on an
      // endpoint anyone with a link can reach, so it stays in the log.
      return c.json(
        internalError('failed to confirm the entry', result.error),
        500,
      );
    }
    return c.json({status: result.status});
  },
);
