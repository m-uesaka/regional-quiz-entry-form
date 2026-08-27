import {error, fail} from '@sveltejs/kit';
import {
  EntryInputSchema,
  isWithinEntryPeriod,
  TournamentTypeSchema,
  type CustomFieldValues,
  type FormFieldDef,
  type Regulation,
  type Tournament,
} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {readCustomFieldValues} from '$lib/server/custom-field-values';
import type {Actions, PageServerLoad, RequestEvent} from './$types';

/**
 * Per-field validation messages, keyed by field name. Spelled out as a
 * record (rather than left as Zod's per-schema shape) so every failure this
 * action returns carries the same type and the page can index it by a
 * field name.
 */
type EntryFieldErrors = Record<string, string[] | undefined>;

/** The entry form's own fields, echoed back verbatim after a failure. */
interface EntryFormValues {
  name: string;
  furigana: string;
  displayName: string;
  email: string;
  regulationId: string;
  freeText: string;
  customFieldValues: CustomFieldValues;
}

/**
 * The backend's `error` strings mapped to what the form shows. The API
 * answers in English identifiers meant for clients, and the same status can
 * stand for several distinct refusals (403 is both "entry period closed"
 * and "wrong regulation during a priority window"), so the message — not
 * the status alone — decides the wording.
 */
const ENTRY_ERROR_MESSAGES: Record<string, string> = {
  'invalid tournament': '大会が見つかりません',
  'entry period closed': 'エントリー期間外です',
  'regulation not eligible in priority window':
    '現在は優先期間中のため、選択したレギュレーションではエントリーできません',
  'invalid password':
    'このメールアドレスは登録済みです。登録時のパスワードを入力してください',
  'already registered in another region':
    'このメールアドレスは別の地域で登録済みです',
  'already entered': 'この大会には既にエントリー済みです',
};

/** Fallbacks for a status whose `error` string isn't one we know. */
const ENTRY_STATUS_MESSAGES: Record<number, string> = {
  400: '入力内容を確認してください',
  401: 'パスワードが正しくありません',
  403: 'この内容ではエントリーできません',
  409: '既にエントリー済みです',
};

/**
 * Reads the `{error: string}` body the backend returns with every failure.
 * The RPC client types the body as a union across statuses, so it is
 * narrowed here rather than asserted.
 * @param res The failed API response.
 */
async function readErrorCode(res: {json(): Promise<unknown>}): Promise<string> {
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
    // A non-JSON body (a proxy error page, say) leaves the status to speak
    // for itself.
  }
  return '';
}

/**
 * Fetches the tournament named by the route, applying the same "not found"
 * / entry-period rules the page's `load` does. Used by both `load` and the
 * action, which needs the tournament's ID to post the entry.
 * @param params The route parameters.
 * @param fetch SvelteKit's `event.fetch`.
 */
async function fetchTournament(
  params: RequestEvent['params'],
  fetch: RequestEvent['fetch'],
): Promise<Tournament> {
  // The RPC client's param type for `tournamentSlug` is the literal union
  // `'saikyoi' | 'shinjinou'` (inferred from the backend's zValidator), not
  // a bare `string`, so a raw route param needs narrowing before it
  // typechecks. An invalid slug is reported as "not found", not a 500.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }

  const api = createApiClient(fetch);
  const res = await api.api.tournaments[':regionSlug'][':tournamentSlug'].$get({
    param: {regionSlug: params.regionSlug, tournamentSlug: parsedType.data},
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw error(404, '大会が見つかりません');
    }
    throw error(502, '大会情報の取得に失敗しました');
  }
  return res.json();
}

/**
 * Fetches the regulations the form offers to choose between. Only `load`
 * needs these: the submitted `regulationId` is validated by the API, not
 * against this list.
 * @param tournamentId The tournament the form belongs to.
 * @param fetch SvelteKit's `event.fetch`.
 */
async function fetchRegulations(
  tournamentId: string,
  fetch: RequestEvent['fetch'],
): Promise<Regulation[]> {
  const api = createApiClient(fetch);
  const res = await api.api.tournaments[':tournamentId'].regulations.$get({
    param: {tournamentId},
  });
  if (!res.ok) {
    throw error(502, 'エントリーフォームの取得に失敗しました');
  }
  return res.json();
}

/**
 * Fetches the tournament's custom form fields. Needed by `load` to render
 * them and by the action to interpret what came back, so it's kept
 * separate from `fetchRegulations` — a submission shouldn't pay for a
 * regulations read it throws away.
 * @param tournamentId The tournament the form belongs to.
 * @param fetch SvelteKit's `event.fetch`.
 */
async function fetchFormFieldDefs(
  tournamentId: string,
  fetch: RequestEvent['fetch'],
): Promise<FormFieldDef[]> {
  const api = createApiClient(fetch);
  const res = await api.api['form-definitions'][':tournamentId'].$get({
    param: {tournamentId},
  });
  if (!res.ok) {
    throw error(502, 'エントリーフォームの取得に失敗しました');
  }
  return res.json();
}

export const load: PageServerLoad = async ({params, fetch, locals}) => {
  const tournament = await fetchTournament(params, fetch);

  if (
    !isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt) &&
    !locals.staff
  ) {
    throw error(403, 'エントリー期間外です');
  }

  // Both are public reads and neither depends on the other, so they run
  // concurrently.
  const [regulations, formFieldDefs] = await Promise.all([
    fetchRegulations(tournament.id, fetch),
    fetchFormFieldDefs(tournament.id, fetch),
  ]);
  return {tournament, regulations, formFieldDefs};
};

export const actions = {
  default: async ({params, request, fetch}) => {
    const tournament = await fetchTournament(params, fetch);
    // The field definitions decide how the submitted body is interpreted,
    // so they're re-read from the API rather than trusted from the client.
    const formFieldDefs = await fetchFormFieldDefs(tournament.id, fetch);

    const formData = await request.formData();
    const freeText = String(formData.get('freeText') ?? '');
    // Echoed back with every failure so a rejected submission re-renders
    // what the participant typed. The two password fields are deliberately
    // left out: re-rendering a password into the HTML would put it in the
    // page source and in any cache of it.
    const values: EntryFormValues = {
      name: String(formData.get('name') ?? ''),
      furigana: String(formData.get('furigana') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      email: String(formData.get('email') ?? ''),
      regulationId: String(formData.get('regulationId') ?? ''),
      freeText,
      customFieldValues: readCustomFieldValues(formData, formFieldDefs),
    };

    const parsed = EntryInputSchema.safeParse({
      ...values,
      password: String(formData.get('password') ?? ''),
      passwordConfirm: String(formData.get('passwordConfirm') ?? ''),
      freeText: freeText === '' ? undefined : freeText,
    });
    if (!parsed.success) {
      // Surfaced per field so a mismatched password confirmation — the one
      // failure the participant can't locate from a generic message —
      // points at the field that caused it.
      const fieldErrors: EntryFieldErrors = parsed.error.flatten().fieldErrors;
      return fail(400, {
        error: '入力内容を確認してください',
        fieldErrors,
        values,
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.tournaments[':tournamentId'].entries.$post({
      param: {tournamentId: tournament.id},
      json: parsed.data,
    });
    if (!res.ok) {
      const code = await readErrorCode(res);
      // The API's refusal is about the submission as a whole, not about one
      // input, so there is nothing to attach per field.
      const fieldErrors: EntryFieldErrors = {};
      return fail(res.status, {
        error:
          ENTRY_ERROR_MESSAGES[code] ??
          ENTRY_STATUS_MESSAGES[res.status] ??
          'エントリーの登録に失敗しました',
        fieldErrors,
        values,
      });
    }

    // The entry is created as `pending_verification`; it only counts once
    // the participant follows the link in the confirmation mail, so the
    // page says so rather than redirecting somewhere that would imply the
    // entry is already settled.
    return {submitted: true, email: values.email};
  },
} satisfies Actions;
