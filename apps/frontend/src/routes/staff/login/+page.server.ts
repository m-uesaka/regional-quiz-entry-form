import {fail, redirect} from '@sveltejs/kit';
import {StaffLoginInputSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {staffLandingPath} from '$lib/server/staff-login';
import type {Actions, PageServerLoad} from './$types';

// Which of the fields was wrong is deliberately not said. Telling them
// apart would turn this form into an oracle for which addresses are staff
// addresses — the same reason the backend spends the same PBKDF2 work on an
// unknown address as on a known one. The 区分 is named alongside them: an
// address with a 最強位 account but no 新人王 one (#166) answers the same
// 401 as a wrong password, and choosing the wrong 区分 is the likelier
// mistake.
const INVALID_CREDENTIALS_MESSAGE =
  'メールアドレス・区分・パスワードのいずれかが正しくありません';

/**
 * Reports a password that was just set from an invite (or reset) link, so the
 * staff member is told to use the one they have only now chosen rather than
 * left guessing whether the link worked. `routes/staff/password-reset` is
 * what redirects here with it.
 */
export const load: PageServerLoad = ({url}) => {
  return {passwordSet: url.searchParams.get('reset') === 'done'};
};

export const actions = {
  default: async ({request, fetch, url}) => {
    const formData = await request.formData();
    // Echoed back on failure so a mistyped password doesn't cost the whole
    // form. The password never is.
    const email = readString(formData, 'email');
    const scope = readString(formData, 'scope');

    const parsed = StaffLoginInputSchema.safeParse({
      email,
      scope,
      password: formData.get('password'),
    });
    if (!parsed.success) {
      return fail(400, {
        email,
        scope,
        error: 'メールアドレス・区分・パスワードを入力してください',
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.auth.staff.login.$post({json: parsed.data});
    if (!res.ok) {
      if (res.status === 429) {
        // Counted per IP and per address (#116), so a shared connection can
        // meet it without this visitor having tried anything themselves.
        return fail(429, {
          email,
          scope,
          error:
            'ログインの試行が集中しています。しばらく待ってから再度お試しください',
        });
      }
      if (res.status === 401) {
        return fail(401, {email, scope, error: INVALID_CREDENTIALS_MESSAGE});
      }
      return fail(502, {
        email,
        scope,
        error: 'ログインに失敗しました。時間をおいて再度お試しください',
      });
    }

    const landing = staffLandingPath(
      await res.json(),
      url.searchParams.get('redirectTo'),
    );
    if (!landing) {
      // The session is live at this point; there is simply nowhere to send
      // it, so the only useful thing left is to say so.
      return fail(500, {
        email,
        scope,
        error:
          '担当する大会が設定されていないため、表示できる画面がありません。管理者にお問い合わせください',
      });
    }
    redirect(303, landing);
  },
} satisfies Actions;

/**
 * Reads one text control, which `FormData` types as possibly a file.
 * @param formData The submitted body.
 * @param name The control's name.
 */
function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}
