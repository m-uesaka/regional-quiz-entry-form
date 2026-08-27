import {error, fail, redirect} from '@sveltejs/kit';
import {
  EDITABLE_ENTRY_STATUSES,
  EntryEditInputSchema,
  isWithinEntryPeriod,
  type FormFieldDef,
} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {redirectToParticipantLogin} from '$lib/server/participant-session';
import type {Actions, PageServerLoad} from './$types';

/**
 * Rebuilds the `customFieldValues` map from the submitted form, driven by
 * the tournament's own field definitions rather than by whatever keys the
 * request happens to carry.
 *
 * Checkbox fields are read with `getAll()` since a multi-option group
 * submits one value per checked box; a plain boolean checkbox (no options)
 * submits the browser's default `"on"`, which is normalized to the
 * `[fieldKey]` / `[]` representation `DynamicFormField.svelte` uses.
 * @param formData The submitted form body.
 * @param fieldDefs The tournament's custom form field definitions.
 */
function readCustomFieldValues(
  formData: FormData,
  fieldDefs: FormFieldDef[],
): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const fieldDef of fieldDefs) {
    if (fieldDef.fieldType !== 'checkbox') {
      values[fieldDef.fieldKey] = String(formData.get(fieldDef.fieldKey) ?? '');
      continue;
    }
    const checked = formData.getAll(fieldDef.fieldKey).map(String);
    if (fieldDef.options && fieldDef.options.length > 0) {
      values[fieldDef.fieldKey] = checked;
    } else {
      values[fieldDef.fieldKey] = checked.length > 0 ? [fieldDef.fieldKey] : [];
    }
  }
  return values;
}

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
    const values = {
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
    if (!parsed.success) {
      return fail(400, {error: '入力内容を確認してください', values});
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
        return fail(400, {error: '入力内容を確認してください', values});
      }
      // The API answers 403 both when the entry period has closed and when
      // the entry was cancelled, and the two can only be told apart from a
      // free-form message. Since either can happen between the page load and
      // this submission, the message stays neutral about which one refused.
      if (res.status === 403) {
        return fail(403, {
          error: 'エントリー期間外またはキャンセル済みのため編集できません',
          values,
        });
      }
      if (res.status === 404) {
        return fail(404, {error: 'エントリーが見つかりません', values});
      }
      return fail(502, {error: 'エントリーの更新に失敗しました', values});
    }

    throw redirect(303, '/mypage');
  },
} satisfies Actions;
