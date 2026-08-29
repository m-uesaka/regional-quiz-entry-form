import {z} from 'zod';
import {TournamentTypeSchema} from './tournament';

const EMAIL_MESSAGE = 'メールアドレスの形式が正しくありません';

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

// A staff account as `GET /api/staff/accounts` returns it. `passwordHash` is
// deliberately absent: the list exists to show who covers which tournament,
// and nothing on that screen needs the hash.
//
// `regionSlug` / `regionName` come from the joined `regions` row so the
// admin screen can name a regional account's scope without a second request;
// both are null for `general` staff, who have no region.
export const StaffAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: StaffRoleSchema,
  regionId: z.string().uuid().nullable(),
  regionSlug: z.string().nullable(),
  regionName: z.string().nullable(),
  tournamentType: TournamentTypeSchema.nullable(),
  // False until the account's owner has followed their invite link and
  // chosen a password. An account is created before that happens, so without
  // this the admin screen can't tell a working account from one whose invite
  // is still outstanding — and can't tell whom to re-send it to.
  passwordSet: z.boolean(),
});
export type StaffAccount = z.infer<typeof StaffAccountSchema>;

// `regional` staff are always scoped to one "region × tournament type" pair,
// and `general` staff to neither. A row with only one of the two filled in
// makes `middleware/staff-auth.ts`'s scope check fail for every tournament,
// so the account silently 403s everywhere instead of failing at creation
// time; the union makes such a body unrepresentable rather than merely
// discouraged. The same invariant is a check constraint on the table
// (`supabase/migrations/0015_staff_accounts_scope_and_password_reset.sql`),
// so a row written straight through Supabase can't break it either.
//
// The messages are written out because the admin screen shows them beside
// the control they belong to, and that screen is read in Japanese —
// `Invalid uuid` beside an unselected 担当地域 names neither the control nor
// what to do about it. The region cannot be marked `required` in the markup
// instead: the same form invites `general` staff, for whom the control is
// meant to be left alone.
export const StaffAccountCreateInputSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('general'),
    email: z.string().email({message: EMAIL_MESSAGE}),
  }),
  z.object({
    role: z.literal('regional'),
    email: z.string().email({message: EMAIL_MESSAGE}),
    regionId: z.string().uuid({message: '担当地域を選択してください'}),
    // 担当種別 is a two-option select, so it carries no message of its
    // own: the form cannot submit a value the enum refuses.
    tournamentType: TournamentTypeSchema,
  }),
]);
export type StaffAccountCreateInput = z.infer<
  typeof StaffAccountCreateInputSchema
>;
