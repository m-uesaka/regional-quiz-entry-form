// The rows `seedDatabase()` puts in place before every run, with their ids
// fixed so the tests can address a tournament or a regulation without
// looking it up first.
//
// The two tournaments are deliberately disjoint: `waitlist-flow.spec.ts`
// fills the one-seat 最強位 tournament, and the other specs enter the
// uncapped 新人王 one, so a spec never sees another spec's entries.

import type {StaffRole, TournamentType} from '@regional-quiz/shared';

export interface TournamentFixture {
  id: string;
  type: TournamentType;
  name: string;
  capacity: number | null;
  regulationId: string;
  regulationLabel: string;
  /**
   * Answers that satisfy the tournament's seeded custom form fields, used
   * as `submitEntry()`'s filler. `createEntry()` checks submitted answers
   * against `form_field_defs`, so an entry that leaves a required field out
   * is refused with a 400.
   */
  defaultCustomFieldValues: Record<string, string | string[]>;
}

export interface StaffFixture {
  id: string;
  email: string;
  password: string;
  role: StaffRole;
  regionId: string | null;
  tournamentType: TournamentType | null;
}

export interface FormFieldDefFixture {
  id: string;
  tournamentId: string;
  fieldKey: string;
  label: string;
  fieldType: 'checkbox' | 'radio' | 'textarea';
  required: boolean;
  options: string[] | null;
  displayOrder: number;
}

// `allowsDualEntry` is spelled out rather than left to the column default,
// because `entry-flow.spec.ts` asserts what a region that refuses double
// entries does — a default that changed would otherwise turn that spec into
// a false pass.
export const REGION = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
} as const;

/** One seat only, so the second confirmed entry lands on the waitlist. */
export const SAIKYOI: TournamentFixture = {
  id: '22222222-2222-4222-8222-222222222222',
  type: 'saikyoi',
  name: '東京最強位決定戦',
  capacity: 1,
  regulationId: '22222222-2222-4222-8222-2222222222aa',
  regulationLabel: '一般',
  // No custom fields are seeded for this tournament.
  defaultCustomFieldValues: {},
};

/** Uncapped, so an entry here confirms without touching a waitlist. */
export const SHINJINOU: TournamentFixture = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'shinjinou',
  name: '東京新人王決定戦',
  capacity: null,
  regulationId: '33333333-3333-4333-8333-3333333333aa',
  regulationLabel: '一般',
  // `shirt_size` and `workshops` below are required; `note` is optional and
  // left out.
  defaultCustomFieldValues: {shirt_size: 'M', workshops: ['早押し']},
};

export const TOURNAMENTS: readonly TournamentFixture[] = [SAIKYOI, SHINJINOU];

// Only the 新人王 tournament gets custom fields: `staff-csv.spec.ts`
// asserts that they become the CSV's trailing columns, headed by their
// labels in `displayOrder`.
export const SHINJINOU_FORM_FIELD_DEFS: readonly FormFieldDefFixture[] = [
  {
    id: '44444444-4444-4444-8444-444444444401',
    tournamentId: SHINJINOU.id,
    fieldKey: 'shirt_size',
    label: 'Tシャツサイズ',
    fieldType: 'radio',
    required: true,
    options: ['S', 'M', 'L'],
    displayOrder: 0,
  },
  {
    id: '44444444-4444-4444-8444-444444444402',
    tournamentId: SHINJINOU.id,
    fieldKey: 'note',
    label: '備考',
    fieldType: 'textarea',
    required: false,
    options: null,
    displayOrder: 1,
  },
  // A required checkbox group, which is the one control whose "at least
  // one checked" rule the browser can't express on its own — it is left
  // unconstrained in the server-rendered HTML and only picks up its
  // `required` once the client bundle has taken the form over (#95). This
  // is what gives `entry-flow.spec.ts` something to submit before that
  // happens.
  {
    id: '44444444-4444-4444-8444-444444444403',
    tournamentId: SHINJINOU.id,
    fieldKey: 'workshops',
    label: '参加したい企画',
    fieldType: 'checkbox',
    required: true,
    options: ['早押し', '筆記', 'ボードクイズ'],
    displayOrder: 2,
  },
];

/**
 * Every seeded custom form field, across all tournaments. `seed.ts` inserts
 * these, and `formFieldDefsOf()` is how the UI helpers know which extra
 * controls a tournament's entry form renders.
 */
export const FORM_FIELD_DEFS: readonly FormFieldDefFixture[] =
  SHINJINOU_FORM_FIELD_DEFS;

/**
 * The custom form fields one tournament's entry form renders, in the order
 * it renders them.
 * @param tournament The tournament whose form is being filled in.
 */
export function formFieldDefsOf(
  tournament: TournamentFixture,
): FormFieldDefFixture[] {
  return FORM_FIELD_DEFS.filter(
    field => field.tournamentId === tournament.id,
  ).sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Scoped to 東京 × 新人王, so 最強位 is out of this account's reach. */
export const SHINJINOU_STAFF: StaffFixture = {
  id: '55555555-5555-4555-8555-555555555501',
  email: 'tokyo-shinjinou-staff@example.test',
  password: 'e2e-staff-password',
  role: 'regional',
  regionId: REGION.id,
  tournamentType: 'shinjinou',
};

export const GENERAL_STAFF: StaffFixture = {
  id: '55555555-5555-4555-8555-555555555502',
  email: 'general-staff@example.test',
  password: 'e2e-staff-password',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

export const STAFF: readonly StaffFixture[] = [SHINJINOU_STAFF, GENERAL_STAFF];

/** The password every participant the tests create signs up with. */
export const PARTICIPANT_PASSWORD = 'e2e-participant-password';

/**
 * A fresh participant email, so that specs (and repeated runs against a
 * stack that was not re-seeded) never collide on the global unique
 * constraint over `participants.email`.
 * @param label A short tag naming the participant's role in the test,
 *     which shows up in the address to make a failure easier to read.
 */
export function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}
