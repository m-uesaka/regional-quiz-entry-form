import {fail, redirect} from '@sveltejs/kit';
import {StaffPasswordResetConfirmInputSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {Actions, PageServerLoad} from './$types';

// Shown for a token the API refused as well as for a page opened without one:
// a staff member can't ask for a link themselves, so either way the only way
// forward is a general staff member re-issuing it.
const NEEDS_A_NEW_LINK_MESSAGE =
  'このリンクは無効か、有効期限が切れています。管理スタッフにリンクの再発行を依頼してください';

/**
 * The page the invite mail sent by `POST /api/staff/accounts` links to, and
 * the one a link re-issued from `/api/staff/accounts/:id/password-reset`
 * points at as well (see `apps/backend/src/lib/staff-password-reset.ts`).
 *
 * Unlike the participant screen at `/password-reset` there is no "mail me a
 * link" half to fall back on: staff links are only ever issued by a general
 * staff member for an account they named, which is why the backend has no
 * `/request` sibling for them, so a visit without a token has nothing to
 * offer but an explanation.
 */
export const load: PageServerLoad = ({url}) => {
  return {hasToken: readToken(url) !== null};
};

/**
 * Reads the one-time token out of the page's own URL.
 *
 * A present but empty `?token=` counts as absent, so that `load` and the form
 * action agree on which of the two states a request belongs to: an empty
 * token would otherwise render the password form and then be refused by the
 * schema as if the password were at fault.
 *
 * @param url The URL this page was requested with.
 * @return The token, or `null` when there isn't a usable one.
 */
function readToken(url: URL): string | null {
  return url.searchParams.get('token') || null;
}

export const actions = {
  default: async ({fetch, request, url}) => {
    // The form posts back to this same URL, so the token is read from the
    // query here rather than carried in a hidden field where it would end up
    // in the page source.
    const token = readToken(url);
    if (token === null) {
      // Unreachable from the rendered page, which only shows the form when
      // `load` saw a token; a hand-made POST lands here.
      return fail(400, {error: NEEDS_A_NEW_LINK_MESSAGE});
    }

    const formData = await request.formData();
    const newPassword = String(formData.get('newPassword') ?? '');
    if (newPassword !== String(formData.get('newPasswordConfirm') ?? '')) {
      return fail(400, {error: 'パスワードが一致しません'});
    }
    const parsed = StaffPasswordResetConfirmInputSchema.safeParse({
      token,
      newPassword,
    });
    if (!parsed.success) {
      return fail(400, {error: 'パスワードは8文字以上で入力してください'});
    }

    const api = createApiClient(fetch);
    const res = await api.api.auth.staff['password-reset'].confirm.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      if (res.status === 400) {
        // The API answers 400 for a token that is unknown, already used or
        // expired, and deliberately doesn't say which.
        return fail(400, {error: NEEDS_A_NEW_LINK_MESSAGE});
      }
      return fail(502, {error: 'パスワードの設定に失敗しました'});
    }

    // No session to clear on the way out: a staff member arriving from an
    // invite has none, and the JWT of one who used the link to reset an
    // existing password stays valid on its signature alone until Task 11-3
    // gives it something to check against (see the migration's note on
    // `reset_staff_password`).
    redirect(303, '/staff/login?reset=done');
  },
} satisfies Actions;
