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
