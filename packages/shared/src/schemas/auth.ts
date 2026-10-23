import {z} from 'zod';
import {LOGIN_PASSWORD_MAX_LENGTH} from './password';
import {StaffRoleSchema} from './staff';
import {TournamentTypeSchema} from './tournament';

// Login inputs take any password up to `LOGIN_PASSWORD_MAX_LENGTH`, not the
// rules for setting one (`PasswordSchema` in `../password-policy.ts`): an
// account whose password predates those rules must still be able to log in
// with it. The maximum alone is kept because it protects the hash
// computation, whatever the password.
//
// The schemas of the endpoints that *set* a password live in
// `../password-policy.ts` rather than here, to keep the common-password list
// out of the browser bundle.
export const StaffLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(LOGIN_PASSWORD_MAX_LENGTH),
});
export type StaffLoginInput = z.infer<typeof StaffLoginInputSchema>;

export const ParticipantLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(LOGIN_PASSWORD_MAX_LENGTH),
});
export type ParticipantLoginInput = z.infer<typeof ParticipantLoginInputSchema>;

export const PasswordResetRequestInputSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<
  typeof PasswordResetRequestInputSchema
>;

// The answer to a successful staff login. `regionSlug` and `tournamentType`
// name the single tournament a `regional` account is scoped to, so the login
// screen can send it straight to that tournament's entry list; both are null
// for `general` accounts, which land on the cross-region dashboard instead.
// The slug (rather than the `regionId` the JWT claims carry) is what the
// staff screens are keyed by: `/staff/{regionSlug}/{tournamentType}/entries`.
export const StaffLoginResponseSchema = z.object({
  ok: z.literal(true),
  role: StaffRoleSchema,
  regionSlug: z.string().nullable(),
  tournamentType: TournamentTypeSchema.nullable(),
});
export type StaffLoginResponse = z.infer<typeof StaffLoginResponseSchema>;
