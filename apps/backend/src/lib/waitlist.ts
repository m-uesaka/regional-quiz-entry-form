import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {ResendMailSender} from './mailer';

interface PromotedEntryRow {
  entry_id: string;
  participant_email: string;
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

  const mailer = new ResendMailSender(env.MAIL_API_KEY, env.MAIL_FROM_ADDRESS);
  await mailer.send({
    to: promoted.participant_email,
    subject: 'キャンセル待ちからの繰り上げについて',
    html: '<p>キャンセルが発生したため、あなたのエントリーが確定しました。</p>',
  });
}
