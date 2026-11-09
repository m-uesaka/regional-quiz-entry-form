import type {Cookies} from '@sveltejs/kit';
import {
  StaffLoginScopeSchema,
  TOURNAMENT_TYPE_LABELS,
  type StaffLoginScope,
} from '@regional-quiz/shared';

/**
 * Carries the login's `pendingInviteScopes` across the redirect to the
 * landing page, which is a different request: the login form posts without
 * `use:enhance`, so the action's result never reaches the page it sends the
 * browser to.
 */
export const STAFF_PENDING_INVITES_COOKIE = 'staff_pending_invites';

// Long enough for the redirect to be followed, short enough that a login
// abandoned before landing doesn't warn on a visit days later.
const MAX_AGE_SECONDS = 60 * 5;

/**
 * Remembers which of the address's other accounts still wait on their
 * invite link, for the landing page to warn about. Nothing is written when
 * there are none.
 * @param cookies The login request's cookies.
 * @param scopes The login response's `pendingInviteScopes`.
 */
export function rememberPendingInvites(
  cookies: Cookies,
  scopes: readonly StaffLoginScope[],
): void {
  if (scopes.length === 0) return;
  cookies.set(STAFF_PENDING_INVITES_COOKIE, scopes.join(','), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Reads and clears what `rememberPendingInvites()` wrote, so the warning is
 * shown on the page the login lands on and not on every page after it.
 *
 * The cookie is only ever written by the login action, but it is still read
 * as untrusted input: anything that isn't a scope is dropped.
 * @param cookies The current request's cookies.
 * @return The scopes, in the order `StaffLoginScopeSchema` lists them.
 */
export function takePendingInvites(cookies: Cookies): StaffLoginScope[] {
  const value = cookies.get(STAFF_PENDING_INVITES_COOKIE);
  if (value === undefined) return [];
  cookies.delete(STAFF_PENDING_INVITES_COOKIE, {path: '/'});
  const named = new Set(value.split(','));
  return StaffLoginScopeSchema.options.filter(scope => named.has(scope));
}

/**
 * What a login screen's 区分 calls the account `scope` names, e.g.
 * 「新人王の地域スタッフ」.
 * @param scope The scope.
 */
export function staffScopeLabel(scope: StaffLoginScope): string {
  return scope === 'general'
    ? '統括スタッフ'
    : `${TOURNAMENT_TYPE_LABELS[scope]}の地域スタッフ`;
}

/**
 * The warning to show for the address's accounts still waiting on their
 * invite link, as layout data: a `pendingInvitesMessage` field when there is
 * one, nothing at all when there isn't, so the many pages that build their
 * layout's data by hand needn't spell out its absence.
 * @param scopes What `takePendingInvites()` returned.
 */
export function pendingInvitesData(scopes: readonly StaffLoginScope[]): {
  pendingInvitesMessage?: string;
} {
  if (scopes.length === 0) return {};
  const accounts = scopes.map(staffScopeLabel).join('・');
  return {
    pendingInvitesMessage:
      `このメールアドレスの「${accounts}」のアカウントは、まだパスワードが設定されていません。` +
      '招待メールのリンクからパスワードを設定してください。' +
      'それまでは、そのアカウントの画面(エントリー一覧など)は表示できません。',
  };
}
