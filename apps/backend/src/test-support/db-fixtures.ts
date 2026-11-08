// Rows the local Supabase integration suites seed straight into Postgres:
// a region with one open tournament and one regulation, and entries in it.
// Each suite keeps its rows under a region slug prefix and an email domain
// of its own, and `deleteTestRegionRows()` removes them by those two.
//
// Not imported by `src/index.ts`, so none of this reaches the deployed
// Worker: `wrangler deploy` bundles from that entry point outwards.

import type {SQL} from 'bun';
import {hashPassword} from '../lib/password';
import {generateToken, hashToken} from '../lib/token';

/** The ids `createTournamentAndRegulation()` created. */
export interface TournamentFixture {
  regionId: string;
  tournamentId: string;
  regulationId: string;
}

/**
 * Creates a region, a 最強位 tournament in it whose entry period is open
 * (2020 to 2099), and one regulation of that tournament.
 * @param sql The connection to the local database.
 * @param regionSlug The new region's slug, under the suite's prefix.
 * @param options.capacity The tournament's capacity; unlimited if omitted.
 */
export async function createTournamentAndRegulation(
  sql: SQL,
  regionSlug: string,
  options: {capacity?: number | null} = {},
): Promise<TournamentFixture> {
  const [region] = await sql`
    insert into regions (slug, name)
    values (${regionSlug}, 'テスト地域')
    returning id
  `;
  const [tournament] = await sql`
    insert into tournaments (
      region_id, type, name, capacity, entry_opens_at, entry_closes_at
    ) values (
      ${region.id}, 'saikyoi', 'テスト大会', ${options.capacity ?? null},
      '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
    )
    returning id
  `;
  const [regulation] = await sql`
    insert into regulations (tournament_id, label)
    values (${tournament.id}, 'テストレギュレーション')
    returning id
  `;
  return {
    regionId: region.id as string,
    tournamentId: tournament.id as string,
    regulationId: regulation.id as string,
  };
}

/** The `entry_status` values the fixtures below create entries in. */
export type EntryRowStatus =
  'pending_verification' | 'confirmed' | 'waitlisted' | 'cancelled';

/** The ids `createEntryRow()` created. */
export interface EntryRowFixture {
  participantId: string;
  entryId: string;
}

// Hashed once per process: PBKDF2 is slow on purpose, and no suite logs in
// as these participants.
let fixturePasswordHash: Promise<string> | undefined;

/**
 * Creates a participant under a fresh address at `emailDomain`, and an entry
 * of theirs in `fixture`'s tournament under its regulation.
 * @param sql The connection to the local database.
 * @param fixture Where the entry goes.
 * @param emailDomain The suite's email domain.
 * @param options The entry's columns; each defaults to what a fresh,
 *     unverified entry has.
 */
export async function createEntryRow(
  sql: SQL,
  fixture: TournamentFixture,
  emailDomain: string,
  options: {
    status?: EntryRowStatus;
    waitlistPosition?: number | null;
    emailVerifiedAt?: Date | null;
    displayName?: string;
    freeText?: string | null;
  } = {},
): Promise<EntryRowFixture> {
  fixturePasswordHash ??= hashPassword('quiz-entry-pass1');
  const email = `entry-${crypto.randomUUID()}@${emailDomain}`;
  const [participant] = await sql`
    insert into participants (region_id, email, password_hash)
    values (${fixture.regionId}, ${email}, ${await fixturePasswordHash})
    returning id
  `;
  const [entry] = await sql`
    insert into entries (
      participant_id, tournament_id, name, furigana, display_name,
      free_text, status, waitlist_position, email_verified_at
    ) values (
      ${participant.id}, ${fixture.tournamentId}, '山田太郎', 'ヤマダタロウ',
      ${options.displayName ?? '太郎'}, ${options.freeText ?? null},
      ${options.status ?? 'pending_verification'},
      ${options.waitlistPosition ?? null}, ${options.emailVerifiedAt ?? null}
    )
    returning id
  `;
  await sql`
    insert into entry_regulations (entry_id, regulation_id, tournament_id)
    values (${entry.id}, ${fixture.regulationId}, ${fixture.tournamentId})
  `;
  return {
    participantId: participant.id as string,
    entryId: entry.id as string,
  };
}

/**
 * Issues an email verification token for `entryId`, as a submission's
 * confirmation mail would.
 * @param sql The connection to the local database.
 * @param entryId The entry the token confirms.
 * @param options When the token expires (far in the future if omitted),
 *     and whether it has already been used.
 * @return The raw token, as the verification link carries it.
 */
export async function createVerificationToken(
  sql: SQL,
  entryId: string,
  options: {expiresAt?: string; used?: boolean} = {},
): Promise<string> {
  const token = generateToken();
  await sql`
    insert into email_verification_tokens (
      entry_id, token_hash, expires_at, used_at
    ) values (
      ${entryId}, ${await hashToken(token)},
      ${options.expiresAt ?? '2099-01-01T00:00:00Z'},
      ${options.used ? '2020-01-01T00:00:00Z' : null}
    )
  `;
  return token;
}

/**
 * Deletes what a suite seeded: everything under the regions whose slug
 * starts with `regionSlugPrefix`, and the participants at `emailDomain`.
 * @param sql The connection to the local database.
 * @param regionSlugPrefix The suite's region slug prefix.
 * @param emailDomain The suite's email domain.
 */
export async function deleteTestRegionRows(
  sql: SQL,
  regionSlugPrefix: string,
  emailDomain: string,
): Promise<void> {
  const slugPattern = regionSlugPrefix + '%';
  await sql`delete from email_verification_tokens where entry_id in (
    select id from entries where tournament_id in (
      select id from tournaments where region_id in (
        select id from regions where slug like ${slugPattern}
      )
    )
  )`;
  await sql`delete from form_field_defs where tournament_id in (
    select id from tournaments where region_id in (
      select id from regions where slug like ${slugPattern}
    )
  )`;
  await sql`delete from entries where tournament_id in (
    select id from tournaments where region_id in (
      select id from regions where slug like ${slugPattern}
    )
  )`;
  await sql`delete from participants where email like ${'%@' + emailDomain}`;
  await sql`delete from regulations where tournament_id in (
    select id from tournaments where region_id in (
      select id from regions where slug like ${slugPattern}
    )
  )`;
  await sql`delete from tournaments where region_id in (
    select id from regions where slug like ${slugPattern}
  )`;
  await sql`delete from regions where slug like ${slugPattern}`;
}
