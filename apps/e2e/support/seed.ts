// Puts the local Supabase stack into a known state before a run: every
// application row is cleared, then the fixtures in `./fixtures.ts` are
// inserted. Talking to Postgres directly rather than through the API is
// deliberate — there is no API for creating regions, tournaments,
// regulations or staff accounts (see the "未実装" section of
// `docs/api-endpoints.md`), which is exactly what a run needs to start
// from.

import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {hashPassword} from '@regional-quiz/backend/lib/password';
import {SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL} from './env';
import {
  REGION,
  SHINJINOU_FORM_FIELD_DEFS,
  STAFF,
  TOURNAMENTS,
} from './fixtures';

const ENTRY_OPENED_DAYS_AGO = 1;
const ENTRY_CLOSES_IN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Child tables first: every one of these is referenced by the ones above
// it, so deleting in this order never trips a foreign key.
const TABLES_TO_CLEAR = [
  'email_verification_tokens',
  'password_reset_tokens',
  'entries',
  'participants',
  'form_field_defs',
  'regulations',
  'tournaments',
  'staff_accounts',
  'regions',
] as const;

// `SUPABASE_URL` is read from the ambient environment, so a shell that
// happens to have staging or production values exported would otherwise
// point the wipe below at that database. Only loopback addresses — what
// `supabase start` serves on — are accepted.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '[::1]', '::1']);

/**
 * @param url The URL to inspect.
 * @return Whether `url` parses and names a loopback host.
 */
function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    ({hostname} = new URL(url));
  } catch {
    return false;
  }
  return (
    LOOPBACK_HOSTNAMES.has(hostname) || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Refuses to seed anything but a local stack, because seeding starts by
 * deleting every application row.
 */
function assertLocalSupabase(): void {
  if (isLoopbackUrl(SUPABASE_URL)) {
    return;
  }
  throw new Error(
    `Refusing to seed ${SUPABASE_URL}: E2E seeding deletes every ` +
      'application row and only ever runs against a local Supabase stack. ' +
      'Unset SUPABASE_URL (or point it at 127.0.0.1) and re-run.',
  );
}

function createServiceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false},
  });
}

/**
 * Fails with an actionable message rather than letting a Supabase error
 * surface as an opaque failure in the first test.
 * @param step What was being done, for the message.
 * @param error The error Supabase answered with, if any.
 */
function assertOk(step: string, error: {message: string} | null): void {
  if (error) {
    throw new Error(`E2E seeding failed while ${step}: ${error.message}`);
  }
}

/**
 * Checks that the local Supabase stack is up and that the service role key
 * in use is accepted, so a missing `supabase start` reads as such instead
 * of as a wall of failing tests.
 * @param db The service role client to probe with.
 */
async function assertReachable(db: SupabaseClient): Promise<void> {
  const {error} = await db.from('regions').select('id').limit(1);
  if (!error) {
    return;
  }
  throw new Error(
    `Could not reach the local Supabase stack at ${SUPABASE_URL}: ` +
      `${error.message}\n` +
      'Start it with `bun run db:start` from the repository root. If it is ' +
      'already running, its service role key may differ from the default — ' +
      'export it with `eval "$(bunx supabase status -o env)"` and re-run.',
  );
}

/**
 * Deletes every application row.
 *
 * Supabase refuses an unfiltered delete, so each one is filtered on a
 * predicate every row satisfies: `id` is a non-null primary key on all of
 * these tables.
 * @param db The service role client to delete with.
 */
async function clearAllTables(db: SupabaseClient): Promise<void> {
  for (const table of TABLES_TO_CLEAR) {
    const {error} = await db.from(table).delete().not('id', 'is', null);
    assertOk(`clearing ${table}`, error);
  }
}

/**
 * Clears the database and inserts the fixture region, tournaments,
 * regulations, custom form fields and staff accounts. Aborts unless
 * `SUPABASE_URL` names a loopback address, since the clearing step is
 * destructive.
 *
 * Staff passwords are hashed with the backend's own `hashPassword()`
 * rather than with a precomputed constant, so the fixtures cannot drift
 * out of the format `verifyPassword()` expects.
 */
export async function seedDatabase(): Promise<void> {
  assertLocalSupabase();
  const db = createServiceRoleClient();
  await assertReachable(db);
  await clearAllTables(db);

  assertOk(
    'inserting the region',
    (
      await db.from('regions').insert({
        id: REGION.id,
        slug: REGION.slug,
        name: REGION.name,
      })
    ).error,
  );

  const now = Date.now();
  const entryOpensAt = new Date(now - ENTRY_OPENED_DAYS_AGO * DAY_MS);
  const entryClosesAt = new Date(now + ENTRY_CLOSES_IN_DAYS * DAY_MS);
  assertOk(
    'inserting the tournaments',
    (
      await db.from('tournaments').insert(
        TOURNAMENTS.map(tournament => ({
          id: tournament.id,
          region_id: REGION.id,
          type: tournament.type,
          name: tournament.name,
          capacity: tournament.capacity,
          entry_opens_at: entryOpensAt.toISOString(),
          entry_closes_at: entryClosesAt.toISOString(),
        })),
      )
    ).error,
  );

  // No priority window on either regulation: the priority-window rules are
  // covered by `packages/shared`'s own tests, and leaving them off keeps
  // every entry these specs make eligible.
  assertOk(
    'inserting the regulations',
    (
      await db.from('regulations').insert(
        TOURNAMENTS.map(tournament => ({
          id: tournament.regulationId,
          tournament_id: tournament.id,
          label: tournament.regulationLabel,
          display_order: 0,
        })),
      )
    ).error,
  );

  assertOk(
    'inserting the form field definitions',
    (
      await db.from('form_field_defs').insert(
        SHINJINOU_FORM_FIELD_DEFS.map(field => ({
          id: field.id,
          tournament_id: field.tournamentId,
          field_key: field.fieldKey,
          label: field.label,
          field_type: field.fieldType,
          required: field.required,
          options: field.options,
          display_order: field.displayOrder,
        })),
      )
    ).error,
  );

  const staffRows = await Promise.all(
    STAFF.map(async staff => ({
      id: staff.id,
      email: staff.email,
      password_hash: await hashPassword(staff.password),
      role: staff.role,
      region_id: staff.regionId,
      tournament_type: staff.tournamentType,
    })),
  );
  assertOk(
    'inserting the staff accounts',
    (await db.from('staff_accounts').insert(staffRows)).error,
  );
}
