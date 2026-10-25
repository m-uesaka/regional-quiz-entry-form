import {fail, redirect} from '@sveltejs/kit';
import {StaffPasswordResetRequestInputSchema} from '@regional-quiz/shared';
import {StaffPasswordResetConfirmInputSchema} from '@regional-quiz/shared/password-policy';
import {createApiClient} from '$lib/api';
import {readTurnstileToken, TURNSTILE_TOKEN_FIELD} from '$lib/turnstile';
import {
  clearResetToken,
  readResetToken,
  STAFF_RESET_TOKEN_COOKIE,
  takeResetToken,
} from '$lib/server/reset-token';
import type {Actions, PageServerLoad} from './$types';

// Shown for a token the API refused. The page offers the request form again
// once the token is gone, so asking for a new link is the way forward.
const NEEDS_A_NEW_LINK_MESSAGE =
  'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定を申し込むか、統括スタッフにリンクの再発行を依頼してください';

/**
 * Shown for a 429 from the API, as on the participant screen: the request
 * half mails a link to whatever address it is given, so it is rate limited
 * per IP and per address.
 */
const TOO_MANY_REQUESTS_MESSAGE =
  '送信が集中しています。しばらく待ってから再度お試しください';

/**
 * The page the invite mail sent by `POST /api/staff/accounts` links to, the
 * one a link re-issued from `/api/staff/accounts/:id/password-reset` points
 * at, and the one a staff member's own reset request mails (see
 * `apps/backend/src/lib/staff-password-reset.ts`).
 *
 * Like the participant screen at `/password-reset`, a token means "choose a
 * password" and its absence means "mail me a link" (#175).
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
    const api = createApiClient(fetch);
    // The two forms this page can render are told apart by the token, the
    // same way the page itself picks which one to show.
    const token = readResetToken(cookies, STAFF_RESET_TOKEN_COOKIE);
    if (token === null) {
      const parsed = StaffPasswordResetRequestInputSchema.safeParse({
        email: String(formData.get('email') ?? ''),
        scope: String(formData.get('scope') ?? ''),
      });
      if (!parsed.success) {
        return fail(400, {
          error: 'メールアドレスと区分を正しく入力してください',
          tokenRejected: false,
        });
      }

      // Forwarded as a header, as on the participant screen.
      const turnstileToken = readTurnstileToken(formData);
      const res = await api.api.auth.staff['password-reset'].request.$post(
        {json: parsed.data},
        {headers: {[TURNSTILE_TOKEN_FIELD]: turnstileToken}},
      );
      if (!res.ok) {
        if (res.status === 429) {
          return fail(429, {
            error: TOO_MANY_REQUESTS_MESSAGE,
            tokenRejected: false,
          });
        }
        if (res.status === 400) {
          // The body was checked above, so the only 400 left is the
          // challenge in front of the endpoint refusing the token.
          return fail(400, {
            error:
              '「私はロボットではありません」の確認に失敗しました。ページを再読み込みして、もう一度お試しください',
            tokenRejected: false,
          });
        }
        return fail(502, {
          error: '再設定メールの送信に失敗しました',
          tokenRejected: false,
        });
      }
      // Reported identically whether or not the account exists: the API
      // answers the same way for both on purpose.
      return {sent: true};
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
