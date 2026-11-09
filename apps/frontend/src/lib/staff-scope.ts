import {
  TOURNAMENT_TYPE_LABELS,
  type StaffLoginScope,
} from '@regional-quiz/shared';

/**
 * What the login screen's 区分 calls the account `scope` names, e.g.
 * 「新人王の地域スタッフ」. The login form's options and the warning about
 * accounts still waiting on their invite (`$lib/server/staff-pending-invites`)
 * both name accounts with it, so the warning says what the select says.
 * @param scope The scope.
 */
export function staffScopeLabel(scope: StaffLoginScope): string {
  return scope === 'general'
    ? '統括スタッフ'
    : `${TOURNAMENT_TYPE_LABELS[scope]}の地域スタッフ`;
}
