import {z} from 'zod';
import {isWithinEntryPeriod} from '../logic/entry-period';
import {FormFieldDefSchema} from './form-definition';
import {TournamentTypeSchema} from './tournament';

export const EntryInputSchema = z
  .object({
    name: z.string().min(1),
    furigana: z.string().min(1),
    displayName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    passwordConfirm: z.string().min(8),
    regulationId: z.string().uuid(),
    freeText: z.string().optional(),
    customFieldValues: z.record(
      z.string(),
      z.union([z.string(), z.array(z.string())]),
    ),
  })
  .refine(data => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'パスワードが一致しません',
  });
export type EntryInput = z.infer<typeof EntryInputSchema>;

// The subset of an entry a participant may change themselves from mypage
// (`PATCH /mypage/entries/:entryId`). `email` / `password` are account
// credentials and are changed through the auth flow instead, and
// `regulationId` is fixed at entry time because regulation priority windows
// are evaluated then.
export const EntryEditInputSchema = EntryInputSchema.innerType().pick({
  name: true,
  furigana: true,
  displayName: true,
  freeText: true,
  customFieldValues: true,
});
export type EntryEditInput = z.infer<typeof EntryEditInputSchema>;

export const EntryStatusSchema = z.enum([
  'pending_verification',
  'confirmed',
  'waitlisted',
  'cancelled',
]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const EntrySchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  name: z.string(),
  furigana: z.string(),
  displayName: z.string(),
  email: z.string().email(),
  regulationId: z.string().uuid(),
  regulationLabel: z.string(),
  freeText: z.string().nullable(),
  // Same value union as `EntryInputSchema.customFieldValues` — every stored
  // value originated from that input shape (checkbox/radio/textarea form
  // fields), so `unknown` would be needlessly imprecise here.
  customFieldValues: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string())]),
  ),
  status: EntryStatusSchema,
  waitlistPosition: z.number().int().nullable(),
});
export type Entry = z.infer<typeof EntrySchema>;

// Staff entry-detail response: the entry plus the tournament's ordered
// custom form field definitions, so the staff UI can render each
// `customFieldValues` entry under its human-readable label (and, for a
// boolean checkbox field with no options, a human-readable yes/no value)
// instead of the raw storage key. Only the single-entry detail endpoint
// returns this; the list endpoint doesn't render custom field answers, so
// `EntrySchema` alone still covers it.
export const StaffEntryDetailSchema = EntrySchema.extend({
  formFieldDefs: z.array(FormFieldDefSchema),
});
export type StaffEntryDetail = z.infer<typeof StaffEntryDetailSchema>;

// Statuses exposed by the public entry-list endpoint. `pending_verification`
// entries are excluded from that query, so it is intentionally omitted here
// (unlike `EntryStatusSchema`, which covers every internal status).
export const PublicEntryStatusSchema = z.enum([
  'confirmed',
  'waitlisted',
  'cancelled',
]);
export type PublicEntryStatus = z.infer<typeof PublicEntryStatusSchema>;

// Public entry-list response item: intentionally omits every personal field
// (`name` / `furigana` / `email` / `freeText` etc.) present on `EntrySchema`.
export const EntryListItemSchema = z.object({
  displayName: z.string(),
  status: PublicEntryStatusSchema,
  waitlistPosition: z.number().int().nullable(),
});
export type EntryListItem = z.infer<typeof EntryListItemSchema>;

// `GET /mypage/entries` response item: the logged-in participant's own
// entry, so (unlike `EntryListItemSchema`) every internal status including
// `pending_verification` is exposed, and the parent tournament is embedded
// since mypage lists entries across multiple tournaments at once. The entry
// period travels with it so the list can tell which entries are still
// editable without fetching each one.
export const MypageEntrySchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  status: EntryStatusSchema,
  waitlistPosition: z.number().int().nullable(),
  tournament: z.object({
    name: z.string(),
    type: TournamentTypeSchema,
    regionId: z.string().uuid(),
    entryOpensAt: z.string().datetime({offset: true}),
    entryClosesAt: z.string().datetime({offset: true}),
  }),
});
export type MypageEntry = z.infer<typeof MypageEntrySchema>;

// Japanese display labels for each entry status. Shared because both the
// staff UI and the staff CSV export show the same wording, and a CSV whose
// other columns are Japanese shouldn't fall back to raw storage values like
// `pending_verification`.
export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  pending_verification: 'メール確認待ち',
  confirmed: '確定',
  waitlisted: 'キャンセル待ち',
  cancelled: 'キャンセル',
};

// Statuses a participant may still edit. A cancelled entry is read-only:
// re-entering is Task 5-4's flow, not an edit.
export const EDITABLE_ENTRY_STATUSES: readonly EntryStatus[] = [
  'pending_verification',
  'confirmed',
  'waitlisted',
];

/**
 * Determines whether a participant may still edit one of their entries:
 * the tournament's entry period must be open and the entry must not have
 * been cancelled. Shared so the mypage UI hides what the API would refuse.
 * @param entry The participant's own entry.
 * @param now The current time.
 */
export function isEntryEditable(
  entry: Pick<MypageEntry, 'status'> & {
    tournament: Pick<
      MypageEntry['tournament'],
      'entryOpensAt' | 'entryClosesAt'
    >;
  },
  now: Date = new Date(),
): boolean {
  return (
    EDITABLE_ENTRY_STATUSES.includes(entry.status) &&
    isWithinEntryPeriod(
      entry.tournament.entryOpensAt,
      entry.tournament.entryClosesAt,
      now,
    )
  );
}

// `GET /mypage/entries/:entryId` response: everything the participant's own
// edit screen needs to prefill and re-render the entry form — the currently
// stored editable values and the tournament's custom form field
// definitions, on top of the list item's own fields.
export const MypageEntryDetailSchema = MypageEntrySchema.extend({
  name: z.string(),
  furigana: z.string(),
  displayName: z.string(),
  regulationLabel: z.string(),
  freeText: z.string().nullable(),
  customFieldValues: EntrySchema.shape.customFieldValues,
  formFieldDefs: z.array(FormFieldDefSchema),
});
export type MypageEntryDetail = z.infer<typeof MypageEntryDetailSchema>;
