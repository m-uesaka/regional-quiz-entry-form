import type {TournamentType} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender} from './mailer';
import {buildSystemMail, systemMailSubject} from './system-mail';
import {tournamentDisplayName} from './tournaments';

interface PromotedEntryRow {
  entry_id: string;
  participant_email: string;
}

/** What the promotion mail needs to name the tournament. */
interface PromotedTournamentRow {
  name: string | null;
  type: TournamentType;
  regions: {name: string};
}

/**
 * Promotes the waitlisted entry with the smallest `waitlist_position` for
 * `tournamentId` to `confirmed` and notifies its participant. Does nothing
 * if there is no waitlisted entry, or if the tournament is already at
 * `capacity` because someone else took the vacated seat first.
 *
 * This delegates to the `promote_next_waitlisted_entry` Postgres function,
 * which re-checks capacity and then selects and updates the queue head
 * inside one transaction while holding a lock on the tournament row, so two
 * concurrent vacancies can't both claim the same waitlisted entry and a
 * confirmation that slipped into the seat before this call can't be
 * double-booked (see the migrations for details).
 * @param env The Worker bindings.
 * @param tournamentId The tournament to promote a waitlisted entry for.
 */
export async function promoteNextWaitlistedEntry(
  env: Bindings,
  tournamentId: string,
): Promise<void> {
  const db = createDbClient(env);
  const {data, error} = await db.rpc('promote_next_waitlisted_entry', {
    p_tournament_id: tournamentId,
  });
  if (error) {
    throw new Error(error.message);
  }

  // `db` isn't constructed with generated Database types (see `./db`), so
  // the client can't infer the SETOF row shape for a bare `.rpc()` call; a
  // `.returns<PromotedEntryRow[]>()` chained onto it also doesn't help here,
  // since the library resolves the pre-override result to `any` for an
  // untyped client and its array/single-object override check special-cases
  // `any` into an error union instead of the requested array type.
  const promoted = (data as PromotedEntryRow[] | null)?.[0];
  if (!promoted) {
    return;
  }

  const tournamentName = await readTournamentName(env, tournamentId);
  const promotedTo =
    tournamentName === undefined
      ? 'キャンセル待ちをしていた大会'
      : `キャンセル待ちをしていた「${tournamentName}」`;
  await createMailSender(env).send(
    buildSystemMail(
      promoted.participant_email,
      waitlistPromotionSubject(tournamentName),
      [
        `${promotedTo}でキャンセルが出たため、あなたのエントリーが確定しました。`,
        'エントリーの内容は、マイページから確認できます。参加できなくなった場合は、マイページからエントリーをキャンセルしてください。',
        {label: 'マイページ', url: `${env.FRONTEND_URL}/mypage`},
      ],
    ),
  );
}

/**
 * Reads the display name the promotion mail names the tournament by.
 *
 * Read only once someone was promoted, so the common case of an empty queue
 * costs no extra round trip -- but by then the promotion is committed, and
 * the mail is the participant's only word of it. So a failed read is logged
 * and the mail goes out without the name, rather than not at all.
 * @return The name, or `undefined` when it couldn't be read.
 */
async function readTournamentName(
  env: Bindings,
  tournamentId: string,
): Promise<string | undefined> {
  const {data: tournament, error} = await createDbClient(env)
    .from('tournaments')
    .select('name, type, regions(name)')
    .eq('id', tournamentId)
    .returns<PromotedTournamentRow[]>()
    .maybeSingle();
  if (error || !tournament) {
    console.error('failed to read the tournament for the promotion mail', {
      tournamentId,
      error: error?.message ?? 'tournament not found',
    });
    return undefined;
  }
  return tournamentDisplayName(
    tournament.name,
    tournament.regions.name,
    tournament.type,
  );
}

/**
 * The subject the promotion mail goes out under.
 * @param tournamentName The tournament's display name, or `undefined` when
 *     it couldn't be read.
 */
export function waitlistPromotionSubject(
  tournamentName: string | undefined,
): string {
  return systemMailSubject(
    tournamentName === undefined
      ? 'キャンセル待ちからの繰り上げでエントリーが確定しました'
      : `「${tournamentName}」のエントリーが確定しました(キャンセル待ちからの繰り上げ)`,
  );
}
