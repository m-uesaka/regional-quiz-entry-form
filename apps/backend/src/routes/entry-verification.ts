import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import type {Env} from '../types/env';
import {confirmEntryByToken} from '../lib/entry-confirmation';

export const entryVerificationRoute = new Hono<Env>().get(
  '/verify',
  zValidator('query', z.object({token: z.string().min(1)})),
  async c => {
    const result = await confirmEntryByToken(c.env, c.req.valid('query').token);
    if (!result.ok) {
      return c.json({error: result.error}, 400);
    }
    return c.json({status: result.status});
  },
);
