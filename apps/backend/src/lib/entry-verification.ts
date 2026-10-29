import {
  ENTRY_VERIFICATION_TOKEN_TTL_MS,
  type EntryStatus,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender, type SendMailInput} from './mailer';
import {fetchAllRows} from './paged-select';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';
import {generateToken, hashToken} from './token';
import {tournamentDisplayName} from './tournaments';

type Result<T> = {ok: true; value: T} | {ok: false; error: string};

/**
 * Issues a one-time email verification token for `entryId` and mails a
 * confirmation link to `email`.
 * @param env The Worker bindings.
 * @param entryId The `entries` row awaiting verification.
 * @param email The address to send the verification link to.
 * @param tournamentName The display name of the tournament being entered.
 * @param capped Whether the tournament has a capacity, i.e. whether the
 *     entry could end up waitlisted.
 * @param withdrawnTournaments The display names of the tournaments whose
 *     pending entries this submission withdrew by taking the unverified
 *     account over (#189), or omit when it withdrew none. Empty when the
 *     names couldn't be read, which is still worth telling.
 */
export async function sendVerificationEmail(
  env: Bindings,
  entryId: string,
  email: string,
  tournamentName: string,
  capped: boolean,
  withdrawnTournaments?: readonly string[],
): Promise<void> {
  const {mail} = await issueVerificationMail(
    env,
    entryId,
    email,
    tournamentName,
    capped,
    withdrawnTournaments,
  );
  await createMailSender(env).send(mail);
}

/** A confirmation mail ready to send, and the token row its link names. */
export interface IssuedVerificationMail {
  mail: SendMailInput;
  tokenId: string;
}

/**
 * Issues a one-time email verification token for `entryId` and builds the
 * mail carrying its confirmation link, without sending it.
 *
 * Takes the same arguments as `sendVerificationEmail()`.
 * @throws Error If the token could not be stored.
 */
async function issueVerificationMail(
  env: Bindings,
  entryId: string,
  email: string,
  tournamentName: string,
  capped: boolean,
  withdrawnTournaments?: readonly string[],
): Promise<IssuedVerificationMail> {
  const db = createDbClient(env);
  const token = generateToken();
  const {data, error} = await db
    .from('email_verification_tokens')
    .insert({
      entry_id: entryId,
      token_hash: await hashToken(token),
      expires_at: new Date(
        Date.now() + ENTRY_VERIFICATION_TOKEN_TTL_MS,
      ).toISOString(),
    })
    .select('id')
    .single<{id: string}>();
  if (error) {
    // Don't send a link whose token was never persisted -- the recipient
    // would click through to a token that can never be found.
    throw new Error(`failed to persist verification token: ${error.message}`);
  }

  // The submitter's own name is left out on purpose: anyone can type
  // someone else's address into the form, and whatever they typed as their
  // name would otherwise land in the stranger's inbox under our domain.
  const mail = buildSystemMail(email, verificationMailSubject(tournamentName), [
    `「${tournamentName}」へのエントリーを受け付けました。エントリーはまだ確定していません。`,
    // Opening the link only shows a confirm button: a mail scanner
    // fetching it must not confirm anything (#190).
    '下のリンクを開き、表示されるページのボタンを押してエントリーを確定してください。' +
      (capped
        ? '定員に達している場合は、キャンセル待ちとして受け付けます。'
        : ''),
    {
      label: 'エントリーを確定する',
      url: `${env.FRONTEND_URL}/verify?token=${token}`,
    },
    // An expired link's entry is cancelled by the next entry the
    // participant submits (`lapse_expired_pending_entries()`, #172), so
    // entering again is all it takes.
    `${describeLinkLifetime(ENTRY_VERIFICATION_TOKEN_TTL_MS)}期限が切れた場合は、エントリーフォームからもう一度エントリーしてください。`,
    ...(withdrawnTournaments ? [withdrawalNotice(withdrawnTournaments)] : []),
    'このエントリーに心当たりがない場合は、このメールを破棄してください。リンク先のページでボタンを押さない限り、エントリーは確定しません。',
  ]);
  return {mail, tokenId: data.id};
}

/**
 * Deletes a verification token whose mail never went out.
 *
 * Left in place, the undelivered link would count as live: the entry would
 * be passed over by the next reminder (`fetchResendableEntryIds()`), and a
 * reminder message the queue redelivers after a throttle would find it and
 * send nothing.
 * @param env The Worker bindings.
 * @param tokenId The `email_verification_tokens` row to delete.
 */
export async function discardVerificationToken(
  env: Bindings,
  tokenId: string,
): Promise<Result<void>> {
  const {error} = await createDbClient(env)
    .from('email_verification_tokens')
    .delete()
    .eq('id', tokenId);
  return error
    ? {ok: false, error: error.message}
    : {ok: true, value: undefined};
}

/** The columns of a verification token that say whether it still works. */
interface TokenStateRow {
  expires_at: string;
  used_at: string | null;
}

/**
 * Whether any of an entry's verification tokens can still confirm it --
 * the same test `lapse_expired_pending_entries()` applies before giving up
 * on the entry.
 * @param tokens The entry's `email_verification_tokens` rows.
 * @param now The moment to judge expiry against.
 */
function hasLiveToken(tokens: readonly TokenStateRow[], now: Date): boolean {
  return tokens.some(
    token => token.used_at === null && new Date(token.expires_at) >= now,
  );
}

/** Shape of the `entries` rows `fetchResendableEntryIds()` reads. */
interface PendingEntryRow {
  id: string;
  email_verification_tokens: TokenStateRow[];
}

/**
 * The unconfirmed entries of `tournamentId` that a staff reminder would
 * re-send the confirmation mail to: those with no link left that works.
 *
 * An entry whose link is still live already has a usable mail in its
 * owner's inbox, so it is passed over. That also bounds what the reminder
 * can do to someone whose address a stranger entered under (#192): at most
 * one fixed confirmation mail per link lifetime, however often staff press
 * the button.
 * @param env The Worker bindings.
 * @param tournamentId The tournament whose entries to look at.
 */
export async function fetchResendableEntryIds(
  env: Bindings,
  tournamentId: string,
): Promise<Result<string[]>> {
  const db = createDbClient(env);
  const result = await fetchAllRows<PendingEntryRow>((from, to) =>
    db
      .from('entries')
      .select('id, email_verification_tokens(expires_at, used_at)')
      .eq('tournament_id', tournamentId)
      .eq('status', 'pending_verification')
      .order('id', {ascending: true})
      .range(from, to)
      .returns<PendingEntryRow[]>(),
  );
  if (result.error) {
    return {ok: false, error: result.error.message};
  }
  const now = new Date();
  return {
    ok: true,
    value: result.rows
      .filter(row => !hasLiveToken(row.email_verification_tokens, now))
      .map(row => row.id),
  };
}

/** Shape of the `entries` row `prepareVerificationResend()` reads. */
interface ResendEntryRow {
  id: string;
  status: EntryStatus;
  participants: {email: string};
  tournaments: {
    name: string | null;
    type: TournamentType;
    capacity: number | null;
    regions: {name: string};
  };
  email_verification_tokens: TokenStateRow[];
}

/**
 * Issues a fresh confirmation link for `entryId` and builds the mail
 * carrying it, for the staff reminder's queue consumer.
 *
 * The entry is read again here rather than trusted from when the reminder
 * was enqueued: by the time the message is handled the owner may have
 * confirmed or cancelled it, or a second press of the button may already
 * have given it a new link.
 * @param env The Worker bindings.
 * @param entryId The entry to remind.
 * @returns The mail to send and its token's row -- to discard with
 *     `discardVerificationToken()` if the mail doesn't go out -- or `null`
 *     when the entry no longer needs one: it is gone, no longer
 *     unconfirmed, or has a live link again.
 */
export async function prepareVerificationResend(
  env: Bindings,
  entryId: string,
): Promise<Result<IssuedVerificationMail | null>> {
  const db = createDbClient(env);
  const {data, error} = await db
    .from('entries')
    .select(
      'id, status, participants!inner(email), ' +
        'tournaments!inner(name, type, capacity, regions!inner(name)), ' +
        'email_verification_tokens(expires_at, used_at)',
    )
    .eq('id', entryId)
    .returns<ResendEntryRow[]>()
    .maybeSingle();
  if (error) {
    return {ok: false, error: error.message};
  }
  if (
    !data ||
    data.status !== 'pending_verification' ||
    hasLiveToken(data.email_verification_tokens, new Date())
  ) {
    return {ok: true, value: null};
  }

  const {tournaments: tournament} = data;
  try {
    const issued = await issueVerificationMail(
      env,
      data.id,
      data.participants.email,
      tournamentDisplayName(
        tournament.name,
        tournament.regions.name,
        tournament.type,
      ),
      tournament.capacity !== null,
    );
    return {ok: true, value: issued};
  } catch (issueError) {
    return {
      ok: false,
      error:
        issueError instanceof Error ? issueError.message : String(issueError),
    };
  }
}

/**
 * Tells the owner of the address which pending entries the takeover behind
 * this entry withdrew. They may have been the owner's own, made under a
 * password this submission didn't match or in another region.
 * @param tournamentNames The withdrawn tournaments' display names, or empty
 *     when they couldn't be read.
 */
function withdrawalNotice(tournamentNames: readonly string[]): string {
  const which =
    tournamentNames.length > 0
      ? tournamentNames.map(name => `「${name}」`).join('、') + 'への'
      : '';
  return (
    `このメールアドレスで受け付けていた、まだ確定していない${which}エントリーは、` +
    '異なるパスワードまたは別の地域の大会でエントリーされたため取り消しました。' +
    '取り消したエントリーの確認メールのリンクは使えません。' +
    '引き続き参加を希望する場合は、このエントリーを確定した後、エントリーフォームからもう一度エントリーしてください。'
  );
}

/**
 * The subject the verification mail for `tournamentName` goes out under.
 * @param tournamentName The display name of the tournament being entered.
 */
export function verificationMailSubject(tournamentName: string): string {
  return systemMailSubject(
    `「${tournamentName}」のエントリーを確定してください`,
  );
}
