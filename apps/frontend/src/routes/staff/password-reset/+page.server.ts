import {fail, redirect} from '@sveltejs/kit';
import {StaffPasswordResetConfirmInputSchema} from '@regional-quiz/shared/password-policy';
import {createApiClient} from '$lib/api';
import {
  clearResetToken,
  readResetToken,
  STAFF_RESET_TOKEN_COOKIE,
  takeResetToken,
} from '$lib/server/reset-token';
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
export const load: PageServerLoad = ({cookies, url}) => {
  // The token itself stays in its httpOnly cookie; the page only needs to
  // know whether there is one (`$lib/server/reset-token.ts`).
  return {
    hasToken: takeResetToken(cookies, url, STAFF_RESET_TOKEN_COOKIE) !== null,
  };
};

// Every failure says whether it was the token the API refused
// (`tokenRejected`), which is when the page stops offering the new-password
// form. Spelled out as `false` on the others rather than left off: SvelteKit
// unions the `fail()` payloads into `ActionData`, and TypeScript would
// otherwise drop the one member that has it as a subtype of the rest.
export const actions = {
  default: async ({cookies, fetch, request, url}) => {
    const formData = await request.formData();
    const token = readResetToken(cookies, STAFF_RESET_TOKEN_COOKIE);
    if (token === null) {
      // Unreachable from the rendered page, which only shows the form when
      // `load` saw a token; a hand-made POST lands here.
      return fail(400, {error: NEEDS_A_NEW_LINK_MESSAGE, tokenRejected: false});
    }

    const newPassword = String(formData.get('newPassword') ?? '');
    if (newPassword !== String(formData.get('newPasswordConfirm') ?? '')) {
      return fail(400, {
        error: 'パスワードが一致しません',
        tokenRejected: false,
      });
    }
    const parsed = StaffPasswordResetConfirmInputSchema.safeParse({
      token,
      newPassword,
    });
    if (!parsed.success) {
      // The token was already read as non-empty, so what failed is the
      // password, and the shared schema's own message says which rule it
      // broke (too short, too long, or too common).
      return fail(400, {
        error:
          parsed.error.flatten().fieldErrors.newPassword?.[0] ??
          'パスワードを正しく入力してください',
        tokenRejected: false,
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.auth.staff['password-reset'].confirm.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      if (res.status === 400) {
        // The API answers 400 for a token that is unknown, already used or
        // expired, and deliberately doesn't say which. Whichever it was, the
        // token is no use any more, so the page stops offering the form.
        clearResetToken(cookies, url, STAFF_RESET_TOKEN_COOKIE);
        return fail(400, {
          error: NEEDS_A_NEW_LINK_MESSAGE,
          tokenRejected: true,
        });
      }
      return fail(502, {
        error: 'パスワードの設定に失敗しました',
        tokenRejected: false,
      });
    }

    // The reset moved `staff_accounts.sessions_valid_from` along with the
    // password (`reset_staff_password()`, migration `0020`), so the account's
    // sessions are over -- but a staff cookie this browser holds isn't
    // dropped here, because nothing says it is that account's. The link can
    // be opened in someone else's browser (a general staff member checking an
    // invite, say), and their session is still good. A cookie that did
    // belong to the reset account is dropped the first time the API refuses
    // it (`redirectToStaffLogin()`), or replaced by the login this sends to.
    clearResetToken(cookies, url, STAFF_RESET_TOKEN_COOKIE);
    redirect(303, '/staff/login?reset=done');
  },
} satisfies Actions;
