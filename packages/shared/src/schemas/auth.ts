import {z} from 'zod';

export const StaffLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type StaffLoginInput = z.infer<typeof StaffLoginInputSchema>;

export const ParticipantLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type ParticipantLoginInput = z.infer<typeof ParticipantLoginInputSchema>;

export const PasswordResetRequestInputSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<
  typeof PasswordResetRequestInputSchema
>;

// `newPassword` carries the same minimum length as the password chosen at
// entry time (`EntryInputSchema`), so a reset can't weaken an account below
// what signing up would have allowed.
export const PasswordResetConfirmInputSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type PasswordResetConfirmInput = z.infer<
  typeof PasswordResetConfirmInputSchema
>;
