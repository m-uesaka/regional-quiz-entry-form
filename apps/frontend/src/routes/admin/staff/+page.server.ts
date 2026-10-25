import {error, fail} from '@sveltejs/kit';
import {
  StaffAccountCreateInputSchema,
  TOURNAMENT_TYPE_LABELS,
  TournamentTypeSchema,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {Actions, PageServerLoad} from './$types';

/** The buttons on an account's row. */
type RowIntent = 'resend' | 'revoke' | 'disable' | 'enable';

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
 * What every action hands back. Every branch carries the same properties so
 * the page can read `form.error` without narrowing across the union
 * SvelteKit builds from the actions.
 */
interface StaffActionResult {
  /** Which form the result belongs to. */
  intent: 'invite' | RowIntent;
  /**
   * The account a row button's result belongs to; null for the invite
   * form.
   */
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

export const load: PageServerLoad = async ({fetch, cookies, url}) => {
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
      redirectToStaffLogin(cookies, url);
    }
    error(502, 'スタッフアカウントの取得に失敗しました');
  }
  return {
    accounts: await accountsRes.json(),
    regions: await regionsRes.json(),
  };
};

export const actions = {
  invite: async ({request, fetch, cookies, url}) => {
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
        redirectToStaffLogin(cookies, url);
      }
      if (res.status === 409) {
        // Accounts are unique per address *and* tournament type (#166), so
        // the address may well be in use for the other type; the message
        // names the one that clashed rather than the address alone.
        return inviteFailure(409, values, INVALID_INPUT_MESSAGE, {
          email: [duplicateEmailMessage(values)],
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

  resend: async ({request, fetch, cookies, url}) => {
    const formData = await request.formData();
    const accountId = readString(formData, 'id');

    // The address is never sent: the API reads it off the account's own row
    // so a reset link can only ever go to that mailbox.
    const res = await createApiClient(fetch).api.staff.accounts[':id'][
      'password-reset'
    ].$post({param: {id: accountId}});
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      if (res.status === 409) {
        // The one 409 is a disabled account (#156), which the list offers
        // no resend button for -- so this is a page that went stale.
        return rowFailure(
          'resend',
          409,
          accountId,
          '無効化されたアカウントにはパスワード設定メールを送れません。先に有効化してください',
        );
      }
      return rowFailure(
        'resend',
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

  // Ends every session the account has open (Task 11-3): for a device that
  // was lost, or someone stepping down. The password is left alone, so the
  // owner -- if they are still meant to have access -- just logs in again.
  revoke: async ({request, fetch, cookies, locals, url}) => {
    const formData = await request.formData();
    const accountId = readString(formData, 'id');

    const res = await createApiClient(fetch).api.staff.accounts[':id'][
      'revoke-sessions'
    ].$post({param: {id: accountId}});
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      return rowFailure(
        'revoke',
        res.status === 404 ? 404 : 502,
        accountId,
        res.status === 404
          ? 'スタッフアカウントが見つかりません'
          : 'セッションを無効化できませんでした',
      );
    }

    // Revoking one's own account cuts the session this request came in on
    // too. The API let this one request through, but the reload that would
    // follow is already refused; going straight to the login form, without
    // the cookie the API no longer accepts, says so instead of letting that
    // reload discover it.
    if (locals.staff?.sub === accountId) {
      redirectToStaffLogin(cookies, url);
    }

    return {
      intent: 'revoke',
      accountId,
      saved: true,
      error: null,
      fieldErrors: NO_FIELD_ERRORS,
      values: EMPTY_VALUES,
    } satisfies StaffActionResult;
  },

  // Shuts the account out (#156): no login, no session, no password link,
  // even for someone who knows the password. The API refuses the caller's
  // own account and the last general one; the list offers no button for
  // the former, but the latter can only be found out by asking.
  disable: async ({request, fetch, cookies, url}) => {
    const formData = await request.formData();
    const accountId = readString(formData, 'id');

    const res = await createApiClient(fetch).api.staff.accounts[':id'][
      'disable'
    ].$post({param: {id: accountId}});
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      if (res.status === 409) {
        return rowFailure(
          'disable',
          409,
          accountId,
          (await readErrorMessage(res)) === 'cannot disable your own account'
            ? '自分自身のアカウントは無効化できません'
            : '有効な統括スタッフがいなくなるため、このアカウントは無効化できません',
        );
      }
      return rowFailure(
        'disable',
        res.status === 404 ? 404 : 502,
        accountId,
        res.status === 404
          ? 'スタッフアカウントが見つかりません'
          : 'アカウントを無効化できませんでした',
      );
    }

    return rowSuccess('disable', accountId);
  },

  enable: async ({request, fetch, cookies, url}) => {
    const formData = await request.formData();
    const accountId = readString(formData, 'id');

    const res = await createApiClient(fetch).api.staff.accounts[':id'][
      'enable'
    ].$post({param: {id: accountId}});
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      return rowFailure(
        'enable',
        res.status === 404 ? 404 : 502,
        accountId,
        res.status === 404
          ? 'スタッフアカウントが見つかりません'
          : 'アカウントを有効化できませんでした',
      );
    }

    return rowSuccess('enable', accountId);
  },
} satisfies Actions;

/**
 * The message for an invite refused as a duplicate, naming the kind of
 * account the address already has.
 * @param values What was submitted.
 */
function duplicateEmailMessage(values: StaffInviteValues): string {
  if (values.role === 'general') {
    return 'このメールアドレスの統括スタッフアカウントは既に登録されています';
  }
  const type = TournamentTypeSchema.safeParse(values.tournamentType);
  return type.success
    ? `このメールアドレスの${TOURNAMENT_TYPE_LABELS[type.data]}のアカウントは既に登録されています`
    : 'このメールアドレスは既に登録されています';
}

/**
 * Reports that a row button did what it was pressed for.
 * @param intent Which of the row's buttons was pressed.
 * @param accountId The account the message belongs beside.
 */
function rowSuccess(intent: RowIntent, accountId: string) {
  return {
    intent,
    accountId,
    saved: true,
    error: null,
    fieldErrors: NO_FIELD_ERRORS,
    values: EMPTY_VALUES,
  } satisfies StaffActionResult;
}

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
 * Refuses an action on one account, attaching the message to its own row.
 * @param intent Which of the row's buttons was pressed.
 * @param status The status to answer with.
 * @param accountId The account the message belongs beside.
 * @param message The message to show.
 */
function rowFailure(
  intent: RowIntent,
  status: number,
  accountId: string,
  message: string,
) {
  return fail(status, {
    intent,
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
