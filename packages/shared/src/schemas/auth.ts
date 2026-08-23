import {z} from 'zod';

export const StaffLoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type StaffLoginInput = z.infer<typeof StaffLoginInputSchema>;
