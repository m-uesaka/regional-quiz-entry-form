import {fail, redirect} from '@sveltejs/kit';
import {StaffLoginInputSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {staffLandingPath} from '$lib/server/staff-login';
import type {Actions} from './$types';

// Which of the two fields was wrong is deliberately not said. Telling them
// apart would turn this form into an oracle for which addresses are staff
// addresses — the same reason the backend spends the same PBKDF2 work on an
// unknown address as on a known one.
const INVALID_CREDENTIALS_MESSAGE =
  'メールアドレスまたはパスワードが正しくありません';

export const actions = {
  default: async ({request, fetch, url}) => {
    const formData = await request.formData();
    const submitted = formData.get('email');
    // Echoed back on failure so a mistyped password doesn't cost the whole
    // form. The password never is.
    const email = typeof submitted === 'string' ? submitted : '';

    const parsed = StaffLoginInputSchema.safeParse({
      email,
      password: formData.get('password'),
    });
    if (!parsed.success) {
      return fail(400, {
        email,
        error: 'メールアドレスとパスワードを入力してください',
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.auth.staff.login.$post({json: parsed.data});
    if (!res.ok) {
      if (res.status === 401) {
        return fail(401, {email, error: INVALID_CREDENTIALS_MESSAGE});
      }
      return fail(502, {
        email,
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
        error:
          '担当する大会が設定されていないため、表示できる画面がありません。管理者にお問い合わせください',
      });
    }
    redirect(303, landing);
  },
} satisfies Actions;
