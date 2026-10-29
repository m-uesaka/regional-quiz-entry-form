import type {TournamentType, WaitlistPromotion} from '@regional-quiz/shared';
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

// How many promotion mails are in flight at once. Clearing the capacity of
// a tournament with a long waitlist promotes everyone on it, and one mail
// after another would hold the request for as many round trips.
const MAIL_CONCURRENCY = 5;

/**
 * Promotes as many waitlisted entries for `tournamentId` as there are free
 * seats -- every one of them when the tournament has no capacity -- and
 * mails each participant that their entry is confirmed. Called after a
 * confirmed entry is cancelled, and after staff save a capacity (#223).
 * Does nothing when there is no free seat or nobody waiting.
 *
 * The promotion is the `promote_waitlisted_entries` Postgres function
 * (0037). It locks the tournament row, counts the confirmed entries only
 * once the lock is held -- so a confirmation that slipped into a seat
 * first isn't double-booked -- promotes the head of the queue into the
 * seats left, and renumbers who is still waiting. Counting the free seats
 * rather than promoting one per cancellation also picks up a seat an
 * earlier, failed promotion left empty.
 *
 * The promotions are committed before any mail goes out, so a mail that
 * fails is logged and counted rather than thrown: throwing would report
 * the promotions as not having happened.
 * @param env The Worker bindings.
 * @param tournamentId The tournament a seat may have come free in.
 * @param options A client to reuse, and the tournament's display name if
 *     the caller already knows it (otherwise it is read for the mail).
 * @return How many entries were promoted, and how many of their mails
 *     could not be sent.
 * @throws {Error} If the promotion itself fails.
 */
export async function promoteWaitlistedEntries(
  env: Bindings,
  tournamentId: string,
  options: {
    db?: ReturnType<typeof createDbClient>;
    tournamentName?: string;
  } = {},
): Promise<WaitlistPromotion> {
  const db = options.db ?? createDbClient(env);
  const {data, error} = await db.rpc('promote_waitlisted_entries', {
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
  const promoted = (data as PromotedEntryRow[] | null) ?? [];
  if (promoted.length === 0) {
    return {promotedCount: 0, mailFailedCount: 0};
  }

  const tournamentName =
    options.tournamentName ?? (await readTournamentName(db, tournamentId));
  const mailer = createMailSender(env);
  let mailFailedCount = 0;
  for (let i = 0; i < promoted.length; i += MAIL_CONCURRENCY) {
    const batch = promoted.slice(i, i + MAIL_CONCURRENCY);
    const sent = await Promise.allSettled(
      batch.map(entry =>
        mailer.send(
          buildPromotionMail(env, entry.participant_email, tournamentName),
        ),
      ),
    );
    sent.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        mailFailedCount++;
        console.error('failed to send the waitlist promotion mail', {
          tournamentId,
          entryId: batch[index].entry_id,
          error: outcome.reason,
        });
      }
    });
  }
  return {promotedCount: promoted.length, mailFailedCount};
}

/**
 * The mail telling a participant their waitlisted entry was confirmed.
 * Worded for any reason a seat came free -- a cancellation, or staff
 * raising the capacity -- since the promotion can't tell which freed it.
 * @param env The Worker bindings.
 * @param email The participant's address.
 * @param tournamentName The tournament's display name, or `undefined` when
 *     it couldn't be read.
 */
function buildPromotionMail(
  env: Bindings,
  email: string,
  tournamentName: string | undefined,
) {
  const promotedTo =
    tournamentName === undefined
      ? 'キャンセル待ちをしていた大会'
      : `キャンセル待ちをしていた「${tournamentName}」`;
  return buildSystemMail(email, waitlistPromotionSubject(tournamentName), [
    `${promotedTo}に空きが出たため、あなたのエントリーが確定しました。`,
    'エントリーの内容は、マイページから確認できます。参加できなくなった場合は、マイページからエントリーをキャンセルしてください。',
    {label: 'マイページ', url: `${env.FRONTEND_URL}/mypage`},
  ]);
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
  db: ReturnType<typeof createDbClient>,
  tournamentId: string,
): Promise<string | undefined> {
  const {data: tournament, error} = await db
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
