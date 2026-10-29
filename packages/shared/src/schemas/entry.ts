import {z} from 'zod';
import {emailAddressSchema} from './email';
import {PasswordLengthSchema} from './password';
import {isWithinEntryPeriod} from '../logic/entry-period';
import {
  CUSTOM_FIELD_VALUE_MAX_LENGTH,
  CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH,
  customFieldValuesLength,
} from '../logic/custom-field-values';
import {FormFieldDefSchema} from './form-definition';
import {TournamentTypeSchema} from './tournament';

// Upper bounds on what one entry may store (#122). Without them a single
// request could store megabytes, and the public entry list, the staff list
// and the CSV export would all carry it in full. The values leave plenty of
// room for a Japanese name or reading; the database repeats them as a check
// constraint (`0021_entry_text_length_limits.sql`) because rows are still
// written with plain SQL at times.
export const ENTRY_NAME_MAX_LENGTH = 100;
export const ENTRY_FREE_TEXT_MAX_LENGTH = 2_000;

/**
 * Characters a name has no use for, refused so a name on the public entry
 * list can't display reversed, split over lines, or as something it isn't
 * (#193):
 *
 * - control and format characters (`\p{Cc}` / `\p{Cf}`): C0/C1 controls,
 *   line breaks among them, zero-width characters, and the bidirectional
 *   overrides (U+202E and the like);
 * - the line and paragraph separators (`\p{Zl}` / `\p{Zp}`, U+2028 /
 *   U+2029), which are line breaks without being controls;
 * - lone surrogates (`\p{Cs}`): half of a pair, which is not valid text,
 *   and which the database refuses with a 500 rather than a field error.
 *
 * Two format characters are let through, because emoji are built from them:
 * the zero-width joiner (U+200D) of a composed emoji such as a family, and
 * the tag characters (U+E0020-U+E007F) of a subdivision flag such as
 * England's. Neither reorders or breaks the text around it.
 */
const NAME_FORBIDDEN_CHARACTERS =
  /(?![\u200D\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/**
 * A required single-line name field (`name` / `furigana` / `displayName`),
 * trimmed, then refused in Japanese when empty -- or only whitespace, before
 * the trim -- longer than `ENTRY_NAME_MAX_LENGTH`, or carrying a character
 * in `NAME_FORBIDDEN_CHARACTERS`.
 * @param label The field's Japanese name, as the messages call it.
 */
function nameFieldSchema(label: string) {
  return z
    .string()
    .trim()
    .min(1, {message: `${label}を入力してください`})
    .max(ENTRY_NAME_MAX_LENGTH, {
      message: `${label}は${ENTRY_NAME_MAX_LENGTH}文字以内で入力してください`,
    })
    .refine(value => !NAME_FORBIDDEN_CHARACTERS.test(value), {
      message: `${label}に使用できない文字が含まれています`,
    });
}

// Each answer is bounded on its own, and all of them together: a form may
// have any number of textarea fields, and a checkbox answer may repeat an
// option. The per-answer bound is also checked field by field in
// `findCustomFieldValuesErrors()`, which is what puts the message under the
// control that caused it.
const customFieldValueSchema = z.string().max(CUSTOM_FIELD_VALUE_MAX_LENGTH, {
  message: `回答は${CUSTOM_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`,
});

export const CustomFieldValuesInputSchema = z
  .record(
    z.string(),
    z.union([customFieldValueSchema, z.array(customFieldValueSchema)]),
  )
  .refine(
    values =>
      customFieldValuesLength(values) <= CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH,
    {
      message: `追加項目の回答は合計${CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH}文字以内で入力してください`,
    },
  );

// Every message is spelled out in Japanese because both consumers show
// them to the participant as-is: the entry / mypage-edit forms render
// `fieldErrors` under the field that failed, and the API returns the same
// issues from its `zValidator`. Zod's English defaults ("Invalid email")
// would otherwise surface in an entirely Japanese form.
export const EntryInputSchema = z
  .object({
    name: nameFieldSchema('氏名'),
    furigana: nameFieldSchema('ふりがな'),
    displayName: nameFieldSchema('エントリーリスト掲載名'),
    email: emailAddressSchema('メールアドレスの形式が正しくありません'),
    // Length only: the same field is how a returning participant proves the
    // password they already have, which may predate the common-password
    // rule. The backend applies that rule when the address turns out to be
    // new (`createEntryAfterCheck()`), and mails the refusal like every other
    // answer that depends on the address (#117).
    password: PasswordLengthSchema,
    passwordConfirm: PasswordLengthSchema,
    // A participant may meet several of a tournament's conditions at once
    // (requirements.md renders these as checkboxes), so this is a set. At
    // least one has to be met, which is what `min(1)` says.
    regulationIds: z
      .array(z.string().uuid({message: 'レギュレーションを選択してください'}))
      .min(1, {message: 'レギュレーションを選択してください'}),
    freeText: z
      .string()
      .max(ENTRY_FREE_TEXT_MAX_LENGTH, {
        message: `自由記述は${ENTRY_FREE_TEXT_MAX_LENGTH}文字以内で入力してください`,
      })
      .optional(),
    customFieldValues: CustomFieldValuesInputSchema,
  })
  .refine(data => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'パスワードが一致しません',
  });
export type EntryInput = z.infer<typeof EntryInputSchema>;

// The entry form as a logged-in participant submits it
// (`POST /tournaments/:tournamentId/entries/session`): the session already
// says who they are, so the address and password are left out rather than
// re-sent and re-checked. Kept beside `EntryInputSchema` so both forms
// validate the entry itself with the same rules.
export const EntrySessionInputSchema = EntryInputSchema.innerType().omit({
  email: true,
  password: true,
  passwordConfirm: true,
});
export type EntrySessionInput = z.infer<typeof EntrySessionInputSchema>;

// The subset of an entry a participant may change themselves from mypage
// (`PATCH /mypage/entries/:entryId`). `email` / `password` are account
// credentials and are changed through the auth flow instead, and
// `regulationIds` are fixed at entry time because regulation priority
// windows are evaluated then.
export const EntryEditInputSchema = EntryInputSchema.innerType().pick({
  name: true,
  furigana: true,
  displayName: true,
  freeText: true,
  customFieldValues: true,
});
export type EntryEditInput = z.infer<typeof EntryEditInputSchema>;

// The body of `POST /api/entries/verify`: the one-time token from the
// verification mail. A body rather than a query string, because confirming
// is a change a mail scanner fetching the link must not be able to make
// (#190).
export const EntryVerificationInputSchema = z.object({
  token: z.string().min(1),
});
export type EntryVerificationInput = z.infer<
  typeof EntryVerificationInputSchema
>;

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
  regulationIds: z.array(z.string().uuid()),
  regulationLabels: z.array(z.string()),
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
  // When the entry was confirmed through its mailed link; the list is
  // ordered by it, and shows it so participants can check their place.
  // Null on a cancelled entry, whose time is masked like its name.
  confirmedAt: z.string().datetime({offset: true}).nullable(),
});
export type EntryListItem = z.infer<typeof EntryListItemSchema>;

// `GET /api/tournaments/:tournamentId/entry-counts`: how many entries hold a
// seat and how many are waiting for one, which the entry form uses to say a
// new entry would join the waitlist. Public like the entry list, which
// already shows every confirmed and waitlisted entry one by one.
export const TournamentEntryCountsSchema = z.object({
  confirmedCount: z.number().int().nonnegative(),
  waitlistedCount: z.number().int().nonnegative(),
});
export type TournamentEntryCounts = z.infer<typeof TournamentEntryCountsSchema>;

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
    // Names the tournament's public list page, whose cached copy the
    // frontend drops when the entry is cancelled or edited (#125).
    regionSlug: z.string(),
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
  regulationLabels: z.array(z.string()),
  freeText: z.string().nullable(),
  customFieldValues: EntrySchema.shape.customFieldValues,
  formFieldDefs: z.array(FormFieldDefSchema),
});
export type MypageEntryDetail = z.infer<typeof MypageEntryDetailSchema>;
