import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {ResendMailSender} from './mailer';

interface NextWaitlistedRow {
  id: string;
  participants: {email: string};
}

/**
 * Promotes the waitlisted entry with the smallest `waitlist_position` for
 * `tournamentId` to `confirmed` and notifies its participant. Does nothing
 * if there is no waitlisted entry.
 * @param env The Worker bindings.
 * @param tournamentId The tournament to promote a waitlisted entry for.
 */
export async function promoteNextWaitlistedEntry(
  env: Bindings,
  tournamentId: string,
): Promise<void> {
  const db = createDbClient(env);
  const {data: next} = await db
    .from('entries')
    .select('id, participants(email)')
    .eq('tournament_id', tournamentId)
    .eq('status', 'waitlisted')
    .order('waitlist_position', {ascending: true})
    .limit(1)
    .returns<NextWaitlistedRow[]>()
    .maybeSingle();
  if (!next) {
    return;
  }

  await db
    .from('entries')
    .update({status: 'confirmed', waitlist_position: null})
    .eq('id', next.id);

  const mailer = new ResendMailSender(env.MAIL_API_KEY, env.MAIL_FROM_ADDRESS);
  await mailer.send({
    to: next.participants.email,
    subject: 'キャンセル待ちからの繰り上げについて',
    html: '<p>キャンセルが発生したため、あなたのエントリーが確定しました。</p>',
  });
}
