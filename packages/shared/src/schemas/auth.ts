import {z} from 'zod';
import {emailAddressSchema} from './email';
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
//
// A staff account is named by its address *and* the tournament type it
// covers (#166): the same person often runs both of a region's tournaments
// from one mailbox, and each needs an account of its own, so the address
// alone no longer picks one row. `scope` says which: one of the tournament
// types for a `regional` account, or `general` for a 統括スタッフ account,
// which covers no type at all. It is a plain enum rather than a nullable
// `tournamentType` so the login form can send it as an ordinary select.
// Built from `TournamentTypeSchema` so a tournament type added there can be
// logged in to without this list having to be remembered.
export const StaffLoginScopeSchema = z.enum([
  ...TournamentTypeSchema.options,
  'general',
]);
export type StaffLoginScope = z.infer<typeof StaffLoginScopeSchema>;

export const StaffLoginInputSchema = z.object({
  email: emailAddressSchema(),
  scope: StaffLoginScopeSchema,
  password: z.string().min(1).max(LOGIN_PASSWORD_MAX_LENGTH),
});
export type StaffLoginInput = z.infer<typeof StaffLoginInputSchema>;

export const ParticipantLoginInputSchema = z.object({
  email: emailAddressSchema(),
  password: z.string().min(1).max(LOGIN_PASSWORD_MAX_LENGTH),
});
export type ParticipantLoginInput = z.infer<typeof ParticipantLoginInputSchema>;

export const PasswordResetRequestInputSchema = z.object({
  email: emailAddressSchema(),
});
export type PasswordResetRequestInput = z.infer<
  typeof PasswordResetRequestInputSchema
>;

// A staff member asking for a reset link themselves (#175). Named by the
// same address-and-scope pair as the login, since the address alone may
// hold two accounts.
export const StaffPasswordResetRequestInputSchema = z.object({
  email: emailAddressSchema(),
  scope: StaffLoginScopeSchema,
});
export type StaffPasswordResetRequestInput = z.infer<
  typeof StaffPasswordResetRequestInputSchema
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
