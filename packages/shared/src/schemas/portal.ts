import {z} from 'zod';
import {TournamentTypeSchema} from './tournament';

// One tournament as the participant portal (`GET /api/portal/tournaments`)
// lists it: just enough to name it, link to its entry form
// (`/<regionSlug>/<tournamentType>/entry`) and say whether that form is
// taking entries. Everything in it is already public: the portal lists
// every tournament, including those whose form is closed, so participants
// can see when one opens.
export const PortalTournamentSchema = z.object({
  regionSlug: z.string(),
  regionName: z.string(),
  tournamentType: TournamentTypeSchema,
  tournamentName: z.string(),
  entryOpensAt: z.string().datetime({offset: true}),
  entryClosesAt: z.string().datetime({offset: true}),
});
export type PortalTournament = z.infer<typeof PortalTournamentSchema>;
