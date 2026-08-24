import {Hono} from 'hono';
import {MypageEntrySchema, type MypageEntry} from '@regional-quiz/shared';
import type {ParticipantEnv} from '../types/env';
import {requireParticipant} from '../middleware/participant-auth';
import {createDbClient} from '../lib/db';

/** Shape of an `entries` row joined with its tournament, as selected below (snake_case). */
interface MypageEntryRow {
  id: string;
  tournament_id: string;
  status: MypageEntry['status'];
  waitlist_position: number | null;
  tournaments: {
    name: string;
    type: MypageEntry['tournament']['type'];
    region_id: string;
  };
}

function rowToMypageEntry(row: MypageEntryRow): MypageEntry {
  return MypageEntrySchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    status: row.status,
    waitlistPosition: row.waitlist_position,
    tournament: {
      name: row.tournaments.name,
      type: row.tournaments.type,
      regionId: row.tournaments.region_id,
    },
  });
}

export const mypageRoute = new Hono<ParticipantEnv>()
  .use('*', requireParticipant())
  .get('/entries', async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('entries')
      .select(
        'id, tournament_id, status, waitlist_position, tournaments(name, type, region_id)',
      )
      .eq('participant_id', c.get('participantId'))
      .returns<MypageEntryRow[]>();
    if (error) {
      return c.json({error: error.message}, 500);
    }
    return c.json((data ?? []).map(rowToMypageEntry));
  });
