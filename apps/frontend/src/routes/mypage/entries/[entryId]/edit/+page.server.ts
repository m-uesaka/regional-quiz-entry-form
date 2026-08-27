import {error, fail, redirect} from '@sveltejs/kit';
import {
  EDITABLE_ENTRY_STATUSES,
  EntryEditInputSchema,
  findCustomFieldValuesErrors,
  isWithinEntryPeriod,
} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {
  customFieldErrors,
  readCustomFieldValues,
} from '$lib/server/custom-field-values';
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

/**
 * Loads the participant's own entry, applying the same editability rule as
 * the API (`isEntryEditable`) so a directly opened URL cannot render a form
 * whose every save the backend would refuse.
 */
export const load: PageServerLoad = async ({cookies, params, fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.mypage.entries[':entryId'].$get({
    param: {entryId: params.entryId},
  });
  if (!res.ok) {
    if (res.status === 401) {
      // No session (or one the API no longer honours): the participant is
      // sent to the login form rather than shown an error they can do
      // nothing about.
      redirectToParticipantLogin(cookies);
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
    throw error(403, 'エントリー期間外のため編集できません');
  }
  // The two halves of `isEntryEditable` are checked separately so the
  // participant is told which one refused the edit.
  if (!EDITABLE_ENTRY_STATUSES.includes(entry.status)) {
    throw error(403, 'キャンセル済みのエントリーは編集できません');
  }

  return {entry};
};

export const actions = {
  default: async ({cookies, params, request, fetch}) => {
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
        redirectToParticipantLogin(cookies);
      }
      if (detailRes.status === 404) {
        throw error(404, 'エントリーが見つかりません');
      }
      throw error(502, 'エントリー情報の取得に失敗しました');
    }
    const {formFieldDefs} = await detailRes.json();

    const formData = await request.formData();
    const freeText = String(formData.get('freeText') ?? '');
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
    // round trip instead of one per submission.
    if (!parsed.success || customFieldValuesErrors.length > 0) {
      const fieldErrors: EditFieldErrors = customFieldErrors(
        customFieldValuesErrors,
        formFieldDefs,
      );
      return fail(400, {
        error: '入力内容を確認してください',
        fieldErrors,
        values,
      });
    }

    const res = await api.api.mypage.entries[':entryId'].$patch({
      param: {entryId: params.entryId},
      json: parsed.data,
    });
    if (!res.ok) {
      if (res.status === 401) {
        // The session can die between the two calls this action makes.
        redirectToParticipantLogin(cookies);
      }
      if (res.status === 400) {
        return fail(400, {
          error: '入力内容を確認してください',
          fieldErrors: NO_FIELD_ERRORS,
          values,
        });
      }
      // The API answers 403 both when the entry period has closed and when
      // the entry was cancelled, and the two can only be told apart from a
      // free-form message. Since either can happen between the page load and
      // this submission, the message stays neutral about which one refused.
      if (res.status === 403) {
        return fail(403, {
          error: 'エントリー期間外またはキャンセル済みのため編集できません',
          fieldErrors: NO_FIELD_ERRORS,
          values,
        });
      }
      if (res.status === 404) {
        return fail(404, {
          error: 'エントリーが見つかりません',
          fieldErrors: NO_FIELD_ERRORS,
          values,
        });
      }
      return fail(502, {
        error: 'エントリーの更新に失敗しました',
        fieldErrors: NO_FIELD_ERRORS,
        values,
      });
    }

    throw redirect(303, '/mypage');
  },
} satisfies Actions;
