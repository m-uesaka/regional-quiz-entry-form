import {fail, redirect} from '@sveltejs/kit';
import {ParticipantLoginInputSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {Actions, PageServerLoad} from './$types';

/**
 * Renders the login form, unless the visitor already has a session — in
 * which case there is nothing to log in to and `/mypage` is what they were
 * after. `locals.participant` is the same claim set `hooks.server.ts`
 * verified the session cookie into, so this agrees with what the API would
 * say about the cookie.
 *
 * `passwordReset` reports a reset that just completed (see
 * `routes/password-reset/+page.server.ts`, which redirects here), so the
 * participant is told to use the password they have just chosen.
 */
export const load: PageServerLoad = ({locals, url}) => {
  if (locals.participant) {
    throw redirect(303, '/mypage');
  }
  return {passwordReset: url.searchParams.get('reset') === 'done'};
};

export const actions = {
  default: async ({request, fetch}) => {
    const formData = await request.formData();
    // Echoed back on failure so only the password has to be retyped. The
    // password itself never travels back.
    const email = String(formData.get('email') ?? '');
    const parsed = ParticipantLoginInputSchema.safeParse({
      email,
      password: String(formData.get('password') ?? ''),
    });
    if (!parsed.success) {
      return fail(400, {
        error: 'メールアドレスとパスワードを入力してください',
        email,
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.auth.participant.login.$post({json: parsed.data});
    if (!res.ok) {
      if (res.status === 401) {
        // Deliberately silent about which half was wrong: telling an
        // unregistered address apart from a wrong password here would undo
        // the trouble the API goes to (a dummy hash on every miss) to keep
        // this endpoint from enumerating participant emails.
        return fail(401, {
          error: 'メールアドレスまたはパスワードが違います',
          email,
        });
      }
      return fail(502, {error: 'ログインに失敗しました', email});
    }

    // The session cookie the API answered with is on this response already:
    // `handleFetch` in `src/hooks.server.ts` moves it into SvelteKit's
    // cookie jar as the call comes back.
    throw redirect(303, '/mypage');
  },
} satisfies Actions;
