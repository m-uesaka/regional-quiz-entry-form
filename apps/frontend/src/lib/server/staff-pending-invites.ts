import {
  StaffPendingInvitesSchema,
  type StaffLoginScope,
} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {staffScopeLabel} from '$lib/staff-scope';

/** What the staff layouts add to their data for the warning. */
export interface PendingInvitesData {
  /**
   * The warning, present only when there is one, so the many pages that
   * build their layout's data by hand in tests needn't spell out its
   * absence.
   */
  pendingInvitesMessage?: string;
}

/**
 * The warning for the logged-in address's other accounts that still wait on
 * their invite link, from `GET /api/staff/pending-invites`.
 *
 * Asked on every load of the `/staff` and `/admin` layouts, so the warning
 * stays for as long as an invite is outstanding and goes once it is
 * followed. It is a warning and nothing more: anything short of a
 * well-formed answer -- a refused or failed request, a backend that doesn't
 * have the endpoint (rolled back, or deployed behind the frontend) -- shows
 * no warning rather than failing the page. A dead session is the page's to
 * deal with: its own request gets the same 401 and sends the staff member to
 * log in again.
 * @param fetch The load's `fetch`, which carries the session cookie.
 */
export async function fetchPendingInvitesData(
  fetch: typeof globalThis.fetch,
): Promise<PendingInvitesData> {
  try {
    const res =
      await createApiClient(fetch).api.staff['pending-invites'].$get();
    if (!res.ok) return {};
    const parsed = StaffPendingInvitesSchema.safeParse(await res.json());
    return parsed.success ? pendingInvitesData(parsed.data.scopes) : {};
  } catch (e) {
    console.error('failed to read the pending staff invites', e);
    return {};
  }
}

/**
 * `PendingInvitesData` for `scopes`.
 * @param scopes The accounts still waiting on their invite link.
 */
export function pendingInvitesData(
  scopes: readonly StaffLoginScope[],
): PendingInvitesData {
  if (scopes.length === 0) return {};
  const accounts = scopes.map(staffScopeLabel).join('・');
  return {
    pendingInvitesMessage:
      `このメールアドレスの「${accounts}」のアカウントは、まだパスワードが設定されていません。` +
      '招待メールのリンクからパスワードを設定してください。' +
      'それまでは、そのアカウントの画面(エントリー一覧など)は表示できません。',
  };
}
