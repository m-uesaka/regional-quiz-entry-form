import {z} from 'zod';

// JWT claims issued at participant login.
export const ParticipantClaimsSchema = z.object({
  sub: z.string().uuid(),
  // `participants.password_changed_at` as it stood when this session was
  // issued, in epoch milliseconds. `requireParticipant()` re-reads that column
  // and refuses the session if the value has moved, which is how a password
  // reset cuts the sessions that predate it (see
  // `apps/backend/src/middleware/participant-auth.ts`).
  //
  // Both sides of that comparison come from the same database column, so it
  // is exact: nothing depends on the Worker's clock agreeing with Postgres',
  // which an "issued before the change?" comparison against `iat` would.
  //
  // Required rather than optional: a session that doesn't say which password
  // it was issued for can't be shown to be current, so it has to be refused.
  pwdChangedAt: z.number(),
});
export type ParticipantClaims = z.infer<typeof ParticipantClaimsSchema>;
