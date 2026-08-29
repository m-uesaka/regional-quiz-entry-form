import {error, fail, redirect} from '@sveltejs/kit';
import {StaffAccountCreateInputSchema} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import type {Actions, PageServerLoad} from './$types';

/** Per-field validation messages, keyed by the control's name. */
type StaffFieldErrors = Record<string, string[] | undefined>;

/** The controls of the invite form. */
interface StaffInviteValues {
  email: string;
  role: string;
  regionId: string;
  tournamentType: string;
}

/**
 * What both actions hand back. Every branch carries the same properties so
 * the page can read `form.error` without narrowing across the union
 * SvelteKit builds from the two actions.
 */
interface StaffActionResult {
  /** Which form the result belongs to. */
  intent: 'invite' | 'resend';
  /** The account a `resend` result belongs to; null for the invite form. */
  accountId: string | null;
  saved: boolean;
  error: string | null;
  fieldErrors: StaffFieldErrors;
  /** Echoed back so a rejected invite re-renders what was typed. */
  values: StaffInviteValues;
}

const EMPTY_VALUES: StaffInviteValues = {
  email: '',
  role: 'regional',
  regionId: '',
  tournamentType: 'saikyoi',
};

const INVALID_INPUT_MESSAGE = '入力内容を確認してください';

/** Nothing to attach per control — the refusal is about the request itself. */
const NO_FIELD_ERRORS: StaffFieldErrors = {};

// The one 500 the create endpoint answers that isn't a server fault the
// staff member can ignore: the account exists but its owner never got the
// link, so the fix is the "再送" button rather than another invite (which
// would now be refused as a duplicate address). The API says so in English,
// in a string it documents as the signal for exactly this case.
const MAIL_NOT_SENT_ERROR =
  'account created but the setup mail could not be sent';

export const load: PageServerLoad = async ({fetch, url}) => {
  const api = createApiClient(fetch);
  // The regions are read alongside the accounts because the invite form
  // scopes a regional account to one of them by id, which is not something
  // to ask a staff member to type.
  const [accountsRes, regionsRes] = await Promise.all([
    api.api.staff.accounts.$get(),
    api.api.regions.$get(),
  ]);
  if (!accountsRes.ok || !regionsRes.ok) {
    // The layout guard cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and these requests reaching the backend.
    if (isUnauthorized(accountsRes) || isUnauthorized(regionsRes)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, 'スタッフアカウントの取得に失敗しました');
  }
  return {
    accounts: await accountsRes.json(),
    regions: await regionsRes.json(),
  };
};

export const actions = {
  invite: async ({request, fetch, url}) => {
    const formData = await request.formData();
    const values: StaffInviteValues = {
      email: readString(formData, 'email'),
      role: readString(formData, 'role'),
      regionId: readString(formData, 'regionId'),
      tournamentType: readString(formData, 'tournamentType'),
    };

    // A `general` account is scoped to no region, so the two scope controls
    // are dropped rather than sent along — the schema's `general` branch
    // has no place for them, and the API stores nulls there.
    const parsed = StaffAccountCreateInputSchema.safeParse(
      values.role === 'general'
        ? {role: values.role, email: values.email}
        : values,
    );
    if (!parsed.success) {
      return inviteFailure(
        400,
        values,
        INVALID_INPUT_MESSAGE,
        parsed.error.flatten().fieldErrors as StaffFieldErrors,
      );
    }

    const res = await createApiClient(fetch).api.staff.accounts.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirect(303, staffLoginPath(url));
      }
      if (res.status === 409) {
        return inviteFailure(409, values, INVALID_INPUT_MESSAGE, {
          email: ['このメールアドレスは既に登録されています'],
        });
      }
      if (res.status === 400) {
        // The one 400 the create endpoint raises on its own account is the
        // foreign key on `region_id`, so the message names the control that
        // has to change — but only for the role that has that control.
        // `zValidator` answers 400 too, for a body this action's own check
        // should already have caught; on a `general` invite, where there is
        // no region to speak of, that is all this can be.
        return values.role === 'regional'
          ? inviteFailure(400, values, INVALID_INPUT_MESSAGE, {
              regionId: ['地域が見つかりません'],
            })
          : inviteFailure(400, values, INVALID_INPUT_MESSAGE, NO_FIELD_ERRORS);
      }
      if ((await readErrorMessage(res)) === MAIL_NOT_SENT_ERROR) {
        return inviteFailure(
          500,
          // The account was created, so the form is cleared: re-submitting
          // what is still in it would only be refused as a duplicate.
          EMPTY_VALUES,
          'アカウントは作成しましたが、パスワード設定メールを送信できませんでした。' +
            '一覧の「パスワード設定メールを再送」からやり直してください',
          NO_FIELD_ERRORS,
        );
      }
      return inviteFailure(
        502,
        values,
        'スタッフアカウントの作成に失敗しました',
        NO_FIELD_ERRORS,
      );
    }

    // `load` re-reads the list after the action, so the new account appears
    // without this having to carry it.
    return {
      intent: 'invite',
      accountId: null,
      saved: true,
      error: null,
      fieldErrors: NO_FIELD_ERRORS,
      values: EMPTY_VALUES,
    } satisfies StaffActionResult;
  },

  resend: async ({request, fetch, url}) => {
    const formData = await request.formData();
    const accountId = readString(formData, 'id');

    // The address is never sent: the API reads it off the account's own row
    // so a reset link can only ever go to that mailbox.
    const res = await createApiClient(fetch).api.staff.accounts[':id'][
      'password-reset'
    ].$post({param: {id: accountId}});
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirect(303, staffLoginPath(url));
      }
      return resendFailure(
        res.status === 404 ? 404 : 502,
        accountId,
        res.status === 404
          ? 'スタッフアカウントが見つかりません'
          : 'パスワード設定メールを送信できませんでした',
      );
    }

    return {
      intent: 'resend',
      accountId,
      saved: true,
      error: null,
      fieldErrors: NO_FIELD_ERRORS,
      values: EMPTY_VALUES,
    } satisfies StaffActionResult;
  },
} satisfies Actions;

/**
 * Refuses an invite, marking the offending controls.
 * @param status The status to answer with.
 * @param values What was submitted, to re-render.
 * @param message The message to show above the form.
 * @param fieldErrors The messages to attach per control.
 */
function inviteFailure(
  status: number,
  values: StaffInviteValues,
  message: string,
  fieldErrors: StaffFieldErrors,
) {
  return fail(status, {
    intent: 'invite',
    accountId: null,
    saved: false,
    error: message,
    fieldErrors,
    values,
  } satisfies StaffActionResult);
}

/**
 * Refuses a re-send, attaching the message to the account's own row.
 * @param status The status to answer with.
 * @param accountId The account the message belongs beside.
 * @param message The message to show.
 */
function resendFailure(status: number, accountId: string, message: string) {
  return fail(status, {
    intent: 'resend',
    accountId,
    saved: false,
    error: message,
    fieldErrors: NO_FIELD_ERRORS,
    values: EMPTY_VALUES,
  } satisfies StaffActionResult);
}

/**
 * Reads one text control, which `FormData` types as possibly a file.
 * @param formData The submitted body.
 * @param name The control's name.
 */
function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the `{error: string}` body the backend answers a refusal with.
 * @param res The failed API response.
 */
async function readErrorMessage(res: {
  json(): Promise<unknown>;
}): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
  } catch {
    // A non-JSON body (a proxy error page, say) names no case to handle.
  }
  return '';
}
