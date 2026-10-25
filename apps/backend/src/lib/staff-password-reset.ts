import type {StaffRole, TournamentType} from '@regional-quiz/shared';
import type {StaffPasswordResetConfirmInput} from '@regional-quiz/shared/password-policy';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender} from './mailer';
import {hashPassword} from './password';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';
import {generateToken, hashToken} from './token';
import {tournamentDisplayName} from './tournaments';

// Longer than the participant reset link's hour. A staff link is normally an
// invitation the recipient did not ask for and is not sitting waiting for, so
// an hour would mean most of them expire before they are read and every new
// account needs a second round trip through the general staff. It is still an
// account takeover if intercepted, hence a day rather than a week — and a
// general staff member can re-issue one at any time, which burns the old link
// along with it.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The SQLSTATE `reset_staff_password` (defined by
 * `supabase/migrations/0015_staff_accounts_scope_and_password_reset.sql`)
 * raises when the token is unknown, already used, or expired.
 */
const INVALID_TOKEN_SQLSTATE = 'P0003';

/**
 * The SQLSTATE `issue_staff_password_link` (defined by
 * `supabase/migrations/0027_staff_account_enable_and_link_locking.sql`)
 * raises when the account is disabled (#156).
 */
const ACCOUNT_DISABLED_SQLSTATE = 'P0005';

/**
 * The outcome of issuing a link. A failure carries the underlying message for
 * the caller's log, never for the response body. `disabled` says the account
 * was disabled when the link was about to be written, so none was.
 */
export type StaffPasswordLinkResult =
  {ok: true} | {ok: false; disabled: boolean; error: string};

export type StaffPasswordResetResult =
  {ok: true} | {ok: false; status: 400 | 500; error: string};

interface ResetTokenRow {
  id: string;
}

/**
 * The scope of a staff account, as the setup mail names it. The region's
 * tournaments are embedded whole because `staff_accounts` has no foreign
 * key to `tournaments`; the one of the account's type is picked out below.
 */
interface StaffAccountScopeRow {
  role: StaffRole;
  tournament_type: TournamentType | null;
  // Null for `general` staff, who have no region.
  regions: {
    name: string;
    tournaments: Array<{name: string | null; type: TournamentType}>;
  } | null;
}

/**
 * Names the account a setup mail is for. One address may hold a 最強位 and a
 * 新人王 account at once (#166), so 「スタッフアカウント」 alone wouldn't say
 * which of its two mails sets which password.
 *
 * A regional account is named after its tournament: `(region_id, type)` is
 * unique, so there is at most one. An account may be created before that
 * tournament is, in which case it takes the name the tournament would get
 * by default.
 * @param env The Worker bindings.
 * @param staffAccountId The account to name.
 * @return E.g. 「「東京最強位」のスタッフアカウント」, or the read's error.
 */
async function describeStaffAccount(
  env: Bindings,
  staffAccountId: string,
): Promise<{ok: true; label: string} | {ok: false; error: string}> {
  const {data, error} = await createDbClient(env)
    .from('staff_accounts')
    .select('role, tournament_type, regions(name, tournaments(name, type))')
    .eq('id', staffAccountId)
    .returns<StaffAccountScopeRow[]>()
    .maybeSingle();
  if (error) {
    return {ok: false, error: error.message};
  }
  if (!data) {
    return {ok: false, error: 'staff account not found'};
  }
  if (data.role === 'general' || !data.regions || !data.tournament_type) {
    return {ok: true, label: '統括スタッフアカウント'};
  }
  const type = data.tournament_type;
  const tournament = data.regions.tournaments.find(t => t.type === type);
  const name = tournamentDisplayName(
    tournament?.name ?? null,
    data.regions.name,
    type,
  );
  return {ok: true, label: `「${name}」のスタッフアカウント`};
}

/**
 * Issues a one-time password link for a staff account and mails it to that
 * account's address.
 *
 * Unlike the participant flow, the outcome is reported back rather than
 * swallowed: this is only reachable by an authenticated general staff member
 * acting on an account they just named, so there is no address to enumerate
 * and nothing to hide — while "the invite never went out" is precisely what
 * that staff member needs to know, since the account is unusable until its
 * owner follows the link.
 * @param env The Worker bindings.
 * @param staffAccountId The account the link sets the password for.
 * @param email The address to mail it to, i.e. that account's own.
 */
export async function sendStaffPasswordLink(
  env: Bindings,
  staffAccountId: string,
  email: string,
): Promise<StaffPasswordLinkResult> {
  // Every link this account already has is dropped before the new one is
  // written, expired or not. `reset_staff_password` only burns an account's
  // other links once one of them has been *redeemed*, so without this an
  // invite sent to a mistyped address would stay usable for the rest of its
  // day-long TTL even after the general staff member noticed and re-issued
  // it to the right one -- and whoever holds the wrong link could redeem it
  // first and take the account over.
  //
  // `issue_staff_password_link` does the drop and the write in one
  // transaction, under the account's row lock, and refuses a disabled
  // account there (#156). Checking `disabled_at` here and writing afterwards
  // would let a disable land in between and leave a link behind it.
  //
  // The account is named first, so a failed read leaves no link behind
  // that no mail carries.
  const account = await describeStaffAccount(env, staffAccountId);
  if (!account.ok) {
    return {ok: false, disabled: false, error: account.error};
  }
  const token = generateToken();
  const {error: issueError} = await createDbClient(env).rpc(
    'issue_staff_password_link',
    {
      p_staff_account_id: staffAccountId,
      p_token_hash: await hashToken(token),
      p_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    },
  );
  if (issueError) {
    // Don't mail a link whose token was never persisted: the recipient would
    // click through to a token that can never be found.
    return {
      ok: false,
      disabled: issueError.code === ACCOUNT_DISABLED_SQLSTATE,
      error: issueError.message,
    };
  }

  const mailer = createMailSender(env);
  try {
    // Both a new account's invitation and a re-issued link come through
    // here, so the wording fits either.
    await mailer.send(
      buildSystemMail(email, staffPasswordMailSubject(account.label), [
        `このメールアドレスの${account.label}について、パスワード設定用のリンクが発行されました。下のリンクを開いて、パスワードを設定してください。`,
        {
          label: 'パスワードを設定する',
          url: `${env.FRONTEND_URL}/staff/password-reset?token=${token}`,
        },
        `${describeLinkLifetime(TOKEN_TTL_MS)}期限が切れた場合は、統括スタッフにリンクの再発行を依頼してください。`,
        '設定したパスワードで、スタッフ用のログイン画面からログインできます。',
        {
          label: 'スタッフ用のログイン画面',
          url: `${env.FRONTEND_URL}/staff/login`,
        },
        'このメールに心当たりがない場合は、このメールを破棄してください。',
      ]),
    );
  } catch (mailError) {
    // The token stays in place rather than being deleted: it is unguessable
    // and expires on its own, and the general staff member can re-send the
    // invite once the mail provider is back.
    return {
      ok: false,
      disabled: false,
      error: mailError instanceof Error ? mailError.message : String(mailError),
    };
  }
  return {ok: true};
}

/**
 * The subject a setup mail for the account `accountLabel` names goes out
 * under.
 * @param accountLabel The account, as `describeStaffAccount()` names it.
 */
export function staffPasswordMailSubject(accountLabel: string): string {
  return systemMailSubject(`${accountLabel}のパスワード設定`);
}

/**
 * Sets the password a staff member chose from their invite (or reset) link
 * and burns the link, along with every other one outstanding for the same
 * account.
 *
 * The token check, the password update and that burning all happen inside
 * `reset_staff_password`, so they commit or roll back together and two links
 * for the same account can't be redeemed at once; see the migration for the
 * locking order.
 * @param env The Worker bindings.
 * @param input The validated raw token and the password to set.
 */
export async function confirmStaffPasswordReset(
  env: Bindings,
  input: StaffPasswordResetConfirmInput,
): Promise<StaffPasswordResetResult> {
  const db = createDbClient(env);
  const tokenHash = await hashToken(input.token);

  // A cheap look at the token before the password is hashed: PBKDF2 is
  // deliberately expensive (see `./password`), and hashing up front would let
  // anyone spend that work by posting tokens that were never going to be
  // valid. Nothing is decided here — the row can still be consumed or expire
  // between this read and the call below, which is why `reset_staff_password`
  // re-checks it under the account lock.
  const {data: candidate, error} = await db
    .from('staff_password_reset_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .returns<ResetTokenRow[]>()
    .maybeSingle();
  // A failed read must not be reported as a bad token: that would tell the
  // staff member their link had expired when the database was simply down.
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!candidate) {
    return {ok: false, status: 400, error: 'invalid or expired token'};
  }

  const {error: resetError} = await db.rpc('reset_staff_password', {
    p_token_hash: tokenHash,
    p_password_hash: await hashPassword(input.newPassword),
  });
  if (resetError) {
    if (resetError.code === INVALID_TOKEN_SQLSTATE) {
      return {ok: false, status: 400, error: 'invalid or expired token'};
    }
    return {ok: false, status: 500, error: resetError.message};
  }
  return {ok: true};
}
