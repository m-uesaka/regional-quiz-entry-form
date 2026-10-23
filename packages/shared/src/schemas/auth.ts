import {z} from 'zod';
import {PASSWORD_MAX_LENGTH, PasswordSchema} from './password';
import {StaffRoleSchema} from './staff';
import {TournamentTypeSchema} from './tournament';

// Login inputs take any password up to the maximum length, not
// `PasswordSchema`: an account whose password predates that schema's rules
// must still be able to log in with it. The maximum alone is kept because it
// protects the hash computation, whatever the password.
export const StaffLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type StaffLoginInput = z.infer<typeof StaffLoginInputSchema>;

export const ParticipantLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type ParticipantLoginInput = z.infer<typeof ParticipantLoginInputSchema>;

export const PasswordResetRequestInputSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<
  typeof PasswordResetRequestInputSchema
>;

// `newPassword` follows the same `PasswordSchema` as the password chosen at
// entry time (`EntryInputSchema`), so a reset can't weaken an account below
// what signing up would have allowed.
export const PasswordResetConfirmInputSchema = z.object({
  token: z.string().min(1),
  newPassword: PasswordSchema,
});
export type PasswordResetConfirmInput = z.infer<
  typeof PasswordResetConfirmInputSchema
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

// The body of `POST /api/auth/staff/password-reset/confirm`, which a staff
// member reaches from the invite (or re-issued reset) link mailed to them.
//
// It is deliberately its own schema rather than a reuse of
// `PasswordResetConfirmInputSchema`: the two are separate endpoints with
// separate token tables, and a password rule tightened for staff should not
// silently move the participant form with it. (Today both use the shared
// `PasswordSchema`; tightening staff alone means replacing it here.)
export const StaffPasswordResetConfirmInputSchema = z.object({
  token: z.string().min(1),
  newPassword: PasswordSchema,
});
export type StaffPasswordResetConfirmInput = z.infer<
  typeof StaffPasswordResetConfirmInputSchema
>;
