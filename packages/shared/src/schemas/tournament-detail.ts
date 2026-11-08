import {z} from 'zod';
import {FormFieldDefSchema} from './form-definition';
import {TournamentSchema} from './tournament';

// Response body of `GET /api/tournaments/:id`, what the staff editor loads.
// Kept out of `tournament.ts` because `form-definition.ts` imports that.
export const TournamentDetailSchema = z.object({
  tournament: TournamentSchema,
  /**
   * The 大会名 as staff typed it, or null when it was left blank -- so the
   * form can show it blank again instead of the default name
   * `tournament.name` carries.
   */
  customName: z.string().nullable(),
  /** The tournament's custom form fields, in display order. */
  formFieldDefs: z.array(FormFieldDefSchema),
});
export type TournamentDetail = z.infer<typeof TournamentDetailSchema>;
