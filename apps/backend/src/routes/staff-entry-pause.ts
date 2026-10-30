import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {TournamentEntryPauseInputSchema} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireStaffForTournament} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';
import {
  rowToTournament,
  TOURNAMENT_COLUMNS,
  type TournamentRow,
} from '../lib/tournaments';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

// Pauses or resumes taking entries for one tournament (0039). Open to the
// tournament's own 地域スタッフ as well as 統括スタッフ, unlike the rest of
// the tournament's settings: it is how whoever runs the tournament stops new
// entries while something is put right -- a mistaken regulation, say -- and
// it takes nothing away that resuming doesn't give back.
export const staffEntryPauseRoute = new Hono<StaffEnv>().put(
  '/tournaments/:tournamentId/entry-pause',
  zValidator('param', TournamentIdParamSchema),
  // After the guard, so a caller who may not pause this tournament is
  // refused as such whatever they sent.
  requireStaffForTournament(),
  zValidator('json', TournamentEntryPauseInputSchema),
  async c => {
    const {data, error} = await createDbClient(c.env)
      .from('tournaments')
      .update({entries_paused: c.req.valid('json').paused})
      .eq('id', c.req.valid('param').tournamentId)
      .select(TOURNAMENT_COLUMNS)
      .returns<TournamentRow[]>()
      .maybeSingle();
    if (error) {
      return c.json(
        internalError('failed to pause or resume the entries', error),
        500,
      );
    }
    // Only when the tournament was deleted after the guard read it.
    if (!data) {
      return c.json({error: 'tournament not found'}, 404);
    }
    return c.json(rowToTournament(data));
  },
);
