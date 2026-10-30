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
  // Whether the region lets one participant enter both its 最強位 and its
  // 新人王 (`regions.allows_dual_entry`), for the portal to say so. Already
  // public in effect: the entry form refuses the second entry otherwise.
  regionAllowsDualEntry: z.boolean(),
  tournamentType: TournamentTypeSchema,
  tournamentName: z.string(),
  entryOpensAt: z.string().datetime({offset: true}),
  entryClosesAt: z.string().datetime({offset: true}),
  // Null when the tournament takes any number of entries.
  capacity: z.number().int().positive().nullable(),
  // The regulations with a priority window, for the portal to say which of
  // them is being given priority now. Only a tournament whose entry period
  // is open lists any: outside it the regulations are part of the form the
  // entry-period gate keeps unpublished, so this is empty rather than a
  // second way to read them.
  priorityRegulations: z.array(
    z.object({
      label: z.string(),
      priorityStartsAt: z.string().datetime({offset: true}),
      priorityEndsAt: z.string().datetime({offset: true}),
    }),
  ),
});
export type PortalTournament = z.infer<typeof PortalTournamentSchema>;
