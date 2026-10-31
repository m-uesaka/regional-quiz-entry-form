import {error, fail, redirect} from '@sveltejs/kit';
import {
  EDITABLE_ENTRY_STATUSES,
  ENTRY_ERROR_CODES,
  EntryEditInputSchema,
  findCustomFieldValuesErrors,
  isWithinEntryPeriod,
} from '@regional-quiz/shared';
import {
  createApiClient,
  resolveApiErrorMessage,
  type ApiErrorMessages,
} from '$lib/api';
import {
  customFieldErrors,
  entrySchemaFieldErrors,
  readCustomFieldValues,
  readFormText,
} from '$lib/server/custom-field-values';
import {dropCachedEntryList} from '$lib/server/entry-list-cache';
import {redirectToParticipantLogin} from '$lib/server/participant-session';
import type {EntryEditFormValues} from '$lib/types/entry-form';
import type {Actions, PageServerLoad} from './$types';

/**
 * Per-field validation messages, keyed by the control's name. Every failure
 * this action returns carries one (empty when the refusal is about the
 * submission as a whole) so the page can index it without narrowing across
 * the action's result union.
 */
type EditFieldErrors = Record<string, string[] | undefined>;

/** Nothing to attach per field — the refusal is about the whole edit. */
const NO_FIELD_ERRORS: EditFieldErrors = {};

const ENTRY_PERIOD_CLOSED_MESSAGE = 'エントリー期間外のため編集できません';
const ENTRY_CANCELLED_MESSAGE = 'キャンセル済みのエントリーは編集できません';

/** The fallback for a 400, and what a failed check here says itself. */
const CHECK_INPUT_MESSAGE = '入力内容を確認してください';

/**
 * The statuses a refused edit is answered with as they are, and their
 * wording. Anything else is a failure on our side, answered as a 502.
 */
const EDIT_STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: CHECK_INPUT_MESSAGE,
  // A 403 neither code below explains comes from something in front of the
  // API, so it doesn't claim one of the two reasons.
  403: 'エントリー期間外またはキャンセル済みのため編集できません',
  404: 'エントリーが見つかりません',
};

/**
 * What a refused edit is shown as. Either code can happen between the page
 * load and this submission, and each is told as `load` tells it.
 */
const EDIT_REFUSAL_MESSAGES: ApiErrorMessages = {
  byCode: {
    [ENTRY_ERROR_CODES.ENTRY_PERIOD_CLOSED]: ENTRY_PERIOD_CLOSED_MESSAGE,
    [ENTRY_ERROR_CODES.ENTRY_CANCELLED]: ENTRY_CANCELLED_MESSAGE,
  },
  byStatus: EDIT_STATUS_MESSAGES,
  fallback: 'エントリーの更新に失敗しました',
};

/**
 * Loads the participant's own entry, applying the same editability rule as
 * the API (`isEntryEditable`) so a directly opened URL cannot render a form
 * whose every save the backend would refuse.
 */
export const load: PageServerLoad = async ({cookies, params, fetch, url}) => {
  const api = createApiClient(fetch);
  const res = await api.api.mypage.entries[':entryId'].$get({
    param: {entryId: params.entryId},
  });
  if (!res.ok) {
    if (res.status === 401) {
      // No session (or one the API no longer honours): the participant is
      // sent to the login form rather than shown an error they can do
      // nothing about.
      redirectToParticipantLogin(cookies, url);
    }
    if (res.status === 404) {
      throw error(404, 'エントリーが見つかりません');
    }
    throw error(502, 'エントリー情報の取得に失敗しました');
  }

  const entry = await res.json();
  if (
    !isWithinEntryPeriod(
      entry.tournament.entryOpensAt,
      entry.tournament.entryClosesAt,
    )
  ) {
    throw error(403, ENTRY_PERIOD_CLOSED_MESSAGE);
  }
  // The two halves of `isEntryEditable` are checked separately so the
  // participant is told which one refused the edit.
  if (!EDITABLE_ENTRY_STATUSES.includes(entry.status)) {
    throw error(403, ENTRY_CANCELLED_MESSAGE);
  }

  return {entry};
};

export const actions = {
  default: async ({cookies, params, request, fetch, platform, url}) => {
    const api = createApiClient(fetch);

    // The field definitions decide how the submitted body is interpreted,
    // so they're re-read from the API (which also re-checks ownership)
    // rather than trusted from the client.
    const detailRes = await api.api.mypage.entries[':entryId'].$get({
      param: {entryId: params.entryId},
    });
    if (!detailRes.ok) {
      if (detailRes.status === 401) {
        // The session can die between the page load and this submission.
        redirectToParticipantLogin(cookies, url);
      }
      if (detailRes.status === 404) {
        throw error(404, 'エントリーが見つかりません');
      }
      throw error(502, 'エントリー情報の取得に失敗しました');
    }
    const {formFieldDefs, tournament} = await detailRes.json();

    const formData = await request.formData();
    const freeText = readFormText(formData, 'freeText');
    // Echoed back with every failure so a rejected submission re-renders
    // what the participant typed instead of resetting to the stored entry.
    const values: EntryEditFormValues = {
      name: String(formData.get('name') ?? ''),
      furigana: String(formData.get('furigana') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      freeText,
      customFieldValues: readCustomFieldValues(formData, formFieldDefs),
    };

    const parsed = EntryEditInputSchema.safeParse({
      ...values,
      freeText: freeText === '' ? undefined : freeText,
    });

    // The API checks the custom fields too, but it answers in identifiers
    // that name no field the page can point at, so the same rule is applied
    // here to get the refusal onto the control that caused it. It is also
    // the only check standing behind a required checkbox group, which
    // carries no `required` until the client bundle has taken the form over
    // (#95).
    const customFieldValuesErrors = findCustomFieldValuesErrors(
      formFieldDefs,
      values.customFieldValues,
    );

    // Both checks are reported together rather than the custom fields
    // short-circuiting the schema, so every rejected field is marked in one
    // round trip instead of one per submission. The custom fields' messages
    // are keyed by their namespaced control names, so they can't collide
    // with the schema's.
    if (!parsed.success || customFieldValuesErrors.length > 0) {
      const fieldErrors: EditFieldErrors = {
        ...(parsed.success ? {} : entrySchemaFieldErrors(parsed.error.issues)),
        ...customFieldErrors(customFieldValuesErrors, formFieldDefs),
      };
      return fail(400, {error: CHECK_INPUT_MESSAGE, fieldErrors, values});
    }

    const res = await api.api.mypage.entries[':entryId'].$patch({
      param: {entryId: params.entryId},
      json: parsed.data,
    });
    if (!res.ok) {
      if (res.status === 401) {
        // The session can die between the two calls this action makes.
        redirectToParticipantLogin(cookies, url);
      }
      return fail(res.status in EDIT_STATUS_MESSAGES ? res.status : 502, {
        error: await resolveApiErrorMessage(res, EDIT_REFUSAL_MESSAGES),
        fieldErrors: NO_FIELD_ERRORS,
        values,
      });
    }

    // The display name is on the public list, so its cached copy goes (#125).
    await dropCachedEntryList(platform, url.origin, tournament);
    throw redirect(303, '/mypage');
  },
} satisfies Actions;
