import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {EntryVerificationInputSchema} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {confirmEntryByToken} from '../lib/entry-confirmation';
import {respondFailure} from '../lib/errors';

// A POST, not a GET: confirming spends the token and puts the entry on the
// public list, and a GET is what mail gateways (Outlook Safe Links and the
// like) and chat link previews send to a mailed link before its recipient
// ever clicks it (#190). The frontend's `/verify` page only calls this from
// the form its confirm button submits.
export const entryVerificationRoute = new Hono<Env>().post(
  '/verify',
  zValidator('json', EntryVerificationInputSchema),
  async c => {
    const result = await confirmEntryByToken(c.env, c.req.valid('json').token);
    if (!result.ok) {
      // Only a token the database actually refused is reported as a client
      // error: a 400 is what tells the participant their link is dead and
      // that they should enter again, and saying that after a transient
      // Supabase failure would strand an entry that is still
      // `pending_verification` (a re-entry is refused as a duplicate).
      //
      // Anything else is a Supabase message about the database, on an
      // endpoint anyone with a link can reach, so it stays in the log.
      return respondFailure(c, result, 'failed to confirm the entry');
    }
    return c.json({status: result.status, tournament: result.tournament});
  },
);
