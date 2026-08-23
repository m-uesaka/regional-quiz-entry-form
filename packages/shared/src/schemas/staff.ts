import {z} from 'zod';
import {TournamentTypeSchema} from './tournament';

export const StaffRoleSchema = z.enum(['regional', 'general']);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

// JWT claims issued at staff login. `regionId` and `tournamentType` are
// null for `role: 'general'` staff, who aren't scoped to a single region.
export const StaffClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: StaffRoleSchema,
  regionId: z.string().uuid().nullable(),
  tournamentType: TournamentTypeSchema.nullable(),
});
export type StaffClaims = z.infer<typeof StaffClaimsSchema>;
