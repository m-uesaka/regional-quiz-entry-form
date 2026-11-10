import {Hono} from 'hono';
import {
  EntryInputSchema,
  EntrySessionInputSchema,
  TURNSTILE_ACTIONS,
} from '@regional-quiz/shared';
import type {Env, ParticipantEnv} from '../types/env';
import {
  checkEntrySubmission,
  createEntryForParticipant,
} from '../lib/entry-submission';
import {createEntryUnauthenticated} from '../lib/entry-unauthenticated';
import {respondFailure} from '../lib/errors';
import {requireParticipant} from '../middleware/participant-auth';
import {clientIp, emailKey, rateLimit} from '../middleware/rate-limit';
import {requireTurnstile} from '../middleware/turnstile';
import {TournamentIdParamSchema} from './params';
import {validate} from '../middleware/validate';

// Matches the period both mail-trigger limiters count over
// (`wrangler.toml`).
const MAIL_TRIGGER_LIMIT_PERIOD_SECONDS = 60;

export const entriesRoute = new Hono<Env>().post(
  '/:tournamentId/entries',
  validate('param', TournamentIdParamSchema),
  // Unauthenticated, and every accepted call sends a confirmation mail to
  // whatever address it names, so this is a mail bomb aimed at a third
  // party unless it is both rate limited and behind a challenge.
  rateLimit(
    env => env.MAIL_TRIGGER_IP_RATE_LIMITER,
    c => `ip:${clientIp(c)}`,
    MAIL_TRIGGER_LIMIT_PERIOD_SECONDS,
  ),
  requireTurnstile(TURNSTILE_ACTIONS.ENTRY),
  validate('json', EntryInputSchema),
  async c => {
    const input = c.req.valid('json');
    // Only the refusals that don't depend on the address are answered
    // directly: the tournament, its entry period, the regulations and the
    // custom fields read the same, and take the same time, whoever is
    // entering. They come before the per-address limit, so a submission
    // for a tournament that doesn't exist or has closed spends nothing of
    // the address's budget (#346).
    const check = await checkEntrySubmission(
      c.get('db'),
      c.req.valid('param').tournamentId,
      input,
    );
    if (!check.ok) {
      return respondFailure(c, check);
    }

    // The address being mailed is limited separately from the address doing
    // the mailing, and on its own limiter: a botnet spreads the IP key thin,
    // but the victim's inbox is the same one every time, so that is where the
    // tight number belongs. The key names this endpoint, so reset requests
    // for the same address cannot spend this budget (#295; see `emailKey()`).
    //
    // Over the limit the submission is not refused: refusing it let anyone
    // who knew an address keep its owner's entry answering 429 for as long
    // as they kept submitting under it (#346). The entry is made as usual
    // and only its mail waits on the queue, to be sent when the address has
    // room again -- and then only if the entry still needs it, so of a
    // flood under one unverified address only the latest mail goes out
    // (`lib/deferred-entry-mail.ts`). The answer is the same 202 either
    // way, for the reason below.
    const {success: withinLimit} =
      await c.env.MAIL_TRIGGER_EMAIL_RATE_LIMITER.limit({
        key: emailKey('entry', input.email),
      });

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
      createEntryUnauthenticated(
        c.env,
        c.get('db'),
        check.tournament,
        input,
        withinLimit ? 'now' : 'deferred',
      ),
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
  validate('param', TournamentIdParamSchema),
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
  requireTurnstile(TURNSTILE_ACTIONS.ENTRY),
  validate('json', EntrySessionInputSchema),
  async c => {
    const result = await createEntryForParticipant(
      c.env,
      c.get('db'),
      c.req.valid('param').tournamentId,
      c.get('participantId'),
      c.req.valid('json'),
    );
    if (!result.ok) {
      return respondFailure(c, result);
    }
    return c.json(result.entry, 201);
  },
);
