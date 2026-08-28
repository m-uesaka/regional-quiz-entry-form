import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {EntryInputSchema, type EntryInput} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createEntry} from '../lib/entries';
import {internalError} from '../lib/errors';
import {clientIp, emailKey, rateLimit} from '../middleware/rate-limit';
import {requireTurnstile} from '../middleware/turnstile';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

// Matches the period both mail-trigger limiters count over
// (`wrangler.toml`).
const MAIL_TRIGGER_LIMIT_PERIOD_SECONDS = 60;

export const entriesRoute = new Hono<Env>().post(
  '/:tournamentId/entries',
  zValidator('param', TournamentIdParamSchema),
  // Unauthenticated, and every accepted call sends a confirmation mail to
  // whatever address it names, so this is a mail bomb aimed at a third
  // party unless it is both rate limited and behind a challenge.
  rateLimit(
    env => env.MAIL_TRIGGER_IP_RATE_LIMITER,
    c => `ip:${clientIp(c)}`,
    MAIL_TRIGGER_LIMIT_PERIOD_SECONDS,
  ),
  requireTurnstile(),
  zValidator('json', EntryInputSchema),
  // The address being mailed is limited separately from the address doing
  // the mailing, and on its own limiter: a botnet spreads the IP key thin,
  // but the victim's inbox is the same one every time, so that is where the
  // tight number belongs. The IP key is checked first and so is spent by
  // attempts that never reach the challenge or the schema -- which is why
  // it cannot also carry that number without refusing a club filling in the
  // form from one shared network.
  rateLimit<{out: {json: EntryInput}}>(
    env => env.MAIL_TRIGGER_EMAIL_RATE_LIMITER,
    c => emailKey(c.req.valid('json').email),
    MAIL_TRIGGER_LIMIT_PERIOD_SECONDS,
  ),
  async c => {
    const result = await createEntry(
      c.env,
      c.req.valid('param').tournamentId,
      c.req.valid('json'),
    );
    if (!result.ok) {
      // Unauthenticated, and a 500 here carries whatever Supabase said
      // about the insert — kept server-side. The 4xx messages are the
      // ones the form maps to its own wording.
      if (result.status === 500) {
        return c.json(
          internalError('failed to create the entry', result.error),
          500,
        );
      }
      return c.json({error: result.error}, result.status);
    }
    return c.json(result.entry, 201);
  },
);
