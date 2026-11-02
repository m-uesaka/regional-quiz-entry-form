import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  EntryInputSchema,
  EntrySessionInputSchema,
  type EntryInput,
} from '@regional-quiz/shared';
import type {Env, ParticipantEnv} from '../types/env';
import {
  checkEntrySubmission,
  createEntryForParticipant,
  createEntryUnauthenticated,
} from '../lib/entries';
import {respondFailure} from '../lib/errors';
import {requireParticipant} from '../middleware/participant-auth';
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
    const input = c.req.valid('json');
    // Only the refusals that don't depend on the address are answered
    // directly: the tournament, its entry period, the regulations and the
    // custom fields read the same, and take the same time, whoever is
    // entering.
    const check = await checkEntrySubmission(
      c.env,
      c.req.valid('param').tournamentId,
      input,
    );
    if (!check.ok) {
      return respondFailure(c, check, 'failed to check the entry');
    }

    // Everything past this point depends on the address: whether it is
    // registered, in which region, under which password. Answering with any
    // of that would make this endpoint an oracle for which addresses are
    // registered and where (#117) -- and so would the time it takes, since a
    // registered address costs a password check that an unregistered one
    // doesn't, and a refusal skips the mail a success sends. So the answer
    // is given now, identically for every address, and the rest runs after
    // it in `waitUntil()`. What the submitter needs to know arrives by mail,
    // to the owner of the address only: the verification link, or why there
    // won't be one.
    c.executionCtx.waitUntil(
      createEntryUnauthenticated(c.env, check.tournament, input),
    );
    return c.json({ok: true}, 202);
  },
);

/**
 * The entry form, submitted by a participant who is logged in. The session
 * says whose entry it is, so the body carries no address or password, and
 * refusals are answered directly: the person being told already owns the
 * account they are about.
 */
export const entrySessionRoute = new Hono<ParticipantEnv>().post(
  '/:tournamentId/entries/session',
  zValidator('param', TournamentIdParamSchema),
  requireParticipant(),
  // Still mails a verification link, so the IP limit and the challenge stay.
  // The per-address limit doesn't apply: the link only ever goes to the
  // logged-in participant's own address, which the session already ties to
  // whoever is asking.
  rateLimit(
    env => env.MAIL_TRIGGER_IP_RATE_LIMITER,
    c => `ip:${clientIp(c)}`,
    MAIL_TRIGGER_LIMIT_PERIOD_SECONDS,
  ),
  requireTurnstile(),
  zValidator('json', EntrySessionInputSchema),
  async c => {
    const result = await createEntryForParticipant(
      c.env,
      c.req.valid('param').tournamentId,
      c.get('participantId'),
      c.req.valid('json'),
    );
    if (!result.ok) {
      return respondFailure(c, result, 'failed to create the entry');
    }
    return c.json(result.entry, 201);
  },
);
