import {z} from 'zod';

// JWT claims issued at participant login.
export const ParticipantClaimsSchema = z.object({
  sub: z.string().uuid(),
});
export type ParticipantClaims = z.infer<typeof ParticipantClaimsSchema>;
