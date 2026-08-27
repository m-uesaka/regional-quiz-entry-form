import {fail, redirect} from '@sveltejs/kit';
import {
  PasswordResetConfirmInputSchema,
  PasswordResetRequestInputSchema,
} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {clearParticipantSession} from '$lib/server/participant-session';
import type {Actions, PageServerLoad} from './$types';

/**
 * Decides which half of the reset flow this page is showing.
 *
 * The mail sent by `POST /api/auth/participant/password-reset/request`
 * links here with the one-time token in the query (see
 * `apps/backend/src/lib/password-reset.ts`), so a token means "choose a new
 * password" and its absence means "mail me a link". The token itself is not
 * returned: the form posts back to this same URL, so the action can read it
 * from the query rather than the page having to carry it in a field.
 */
export const load: PageServerLoad = ({url}) => {
  return {hasToken: readToken(url) !== null};
};

/**
 * Reads the reset token out of the page's own URL.
 *
 * A present but empty `?token=` counts as absent, so that `load` and the
 * form action agree on which half of the flow a request belongs to: an empty
 * token would otherwise render the new-password form and then be refused by
 * the schema as if the password were at fault.
 *
 * @param url The URL this page was requested with.
 * @return The token, or `null` when there isn't a usable one.
 */
function readToken(url: URL): string | null {
  return url.searchParams.get('token') || null;
}

export const actions = {
  default: async ({cookies, fetch, request, url}) => {
    const formData = await request.formData();
    const api = createApiClient(fetch);
    // The two forms this page can render are told apart the same way the
    // page itself picks which one to show, so a submission is always
    // answered by the half it came from.
    const token = readToken(url);

    if (token === null) {
      const parsed = PasswordResetRequestInputSchema.safeParse({
        email: String(formData.get('email') ?? ''),
      });
      if (!parsed.success) {
        return fail(400, {error: 'メールアドレスを正しく入力してください'});
      }

      const res = await api.api.auth.participant[
        'password-reset'
      ].request.$post({json: parsed.data});
      if (!res.ok) {
        return fail(502, {error: '再設定メールの送信に失敗しました'});
      }
      // Reported identically whether or not the address is registered: the
      // API answers the same way for both on purpose, and saying "no such
      // account" here would give that back away.
      return {sent: true};
    }

    const newPassword = String(formData.get('newPassword') ?? '');
    if (newPassword !== String(formData.get('newPasswordConfirm') ?? '')) {
      return fail(400, {error: 'パスワードが一致しません'});
    }
    const parsed = PasswordResetConfirmInputSchema.safeParse({
      token,
      newPassword,
    });
    if (!parsed.success) {
      return fail(400, {error: 'パスワードは8文字以上で入力してください'});
    }

    const res = await api.api.auth.participant['password-reset'].confirm.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      if (res.status === 400) {
        // The API answers 400 for a token that is unknown, already used or
        // expired, and doesn't say which; all three are fixed by asking for
        // a new link, which is what the message points at.
        return fail(400, {
          error:
            'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定をやり直してください',
        });
      }
      return fail(502, {error: 'パスワードの再設定に失敗しました'});
    }

    // A reset cuts every session the participant had, this browser's
    // included, so the cookie goes before the redirect: the login page sends
    // a visitor it still reads as logged in to `/mypage`, which would drop
    // the notice below (and cost a pointless round trip through the 401 the
    // API would answer there with).
    clearParticipantSession(cookies);
    // The only thing left to do is log in again with the password they have
    // just chosen.
    throw redirect(303, '/mypage/login?reset=done');
  },
} satisfies Actions;
