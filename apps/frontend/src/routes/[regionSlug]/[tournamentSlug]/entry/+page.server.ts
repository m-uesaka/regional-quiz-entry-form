import {error, fail} from '@sveltejs/kit';
import {
  EntryInputSchema,
  findCustomFieldValuesErrors,
  isWithinEntryPeriod,
  TournamentTypeSchema,
  type FormFieldDef,
  type Regulation,
  type Tournament,
} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {readTurnstileToken, TURNSTILE_TOKEN_FIELD} from '$lib/turnstile';
import {
  customFieldErrors,
  readCustomFieldValues,
} from '$lib/server/custom-field-values';
import type {EntryFieldErrors, EntryFormValues} from '$lib/types/entry-form';
import type {Actions, PageServerLoad, RequestEvent} from './$types';

/**
 * What a 429 from the API is shown as. The rate limit it comes from is
 * counted per IP *and* per address (#116), so a participant can also meet it
 * without having submitted anything themselves -- from a shared connection,
 * say -- which is why the wording asks for patience rather than blaming the
 * submission.
 */
const TOO_MANY_REQUESTS_MESSAGE =
  '送信が集中しています。しばらく待ってから再度お試しください';

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
    '現在は優先期間中のため、優先対象のレギュレーションを1つ以上選択してください',
  'invalid password':
    'このメールアドレスは登録済みです。登録時のパスワードを入力してください',
  'already registered in another region':
    'このメールアドレスは別の地域で登録済みです',
  'already entered': 'この大会には既にエントリー済みです',
  // The regulations changed while the form was open, so what the page
  // offered no longer exists. Reloading is what fixes it.
  'regulation no longer available':
    '選択したレギュレーションが変更されました。ページを再読み込みして、もう一度お試しください',
  'already entered another tournament in this region':
    'この地域では、最強位と新人王のどちらか一方にのみエントリーできます',
  // Answered by the challenge in front of the API, which refuses a missing
  // and an invalid token alike. Both are fixed by solving the widget again.
  'turnstile verification failed':
    '「私はロボットではありません」の確認に失敗しました。ページを再読み込みして、もう一度お試しください',
  'too many requests': TOO_MANY_REQUESTS_MESSAGE,
};

/** Fallbacks for a status whose `error` string isn't one we know. */
const ENTRY_STATUS_MESSAGES: Record<number, string> = {
  400: '入力内容を確認してください',
  401: 'パスワードが正しくありません',
  403: 'この内容ではエントリーできません',
  409: '既にエントリー済みです',
  429: TOO_MANY_REQUESTS_MESSAGE,
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
 * needs these: the submitted `regulationIds` are validated by the API, not
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
    // Written into the form by the Turnstile widget
    // (`$lib/components/Turnstile.svelte`). Not part of the entry, so it
    // travels as a header rather than in the body the schema describes --
    // which is why it is read through a helper that refuses what a header
    // cannot carry.
    const turnstileToken = readTurnstileToken(formData);
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
      // A checkbox group, so every checked box arrives under the same
      // name — `getAll`, not `get`.
      regulationIds: formData.getAll('regulationIds').map(String),
      freeText,
      customFieldValues: readCustomFieldValues(formData, formFieldDefs),
    };

    const parsed = EntryInputSchema.safeParse({
      ...values,
      password: String(formData.get('password') ?? ''),
      passwordConfirm: String(formData.get('passwordConfirm') ?? ''),
      freeText: freeText === '' ? undefined : freeText,
    });

    // The API checks the custom fields too, but it answers in identifiers
    // that name no field the page can point at, so the same rule is applied
    // here to get the refusal onto the control that caused it.
    //
    // It is also the only check standing behind a required checkbox group:
    // that group carries no `required` until the client bundle has taken
    // the form over (#95), so an unanswered one submitted before then — or
    // with JS off — reaches this action instead of being stopped by the
    // browser.
    const customFieldValuesErrors = findCustomFieldValuesErrors(
      formFieldDefs,
      values.customFieldValues,
    );

    // Both checks are reported together rather than the custom fields
    // short-circuiting the schema, so everything wrong with a submission
    // comes back in one round trip. That matters most for exactly the
    // participants this check exists for — those submitting before
    // hydration or with JS off, who get no browser-side complaints at all —
    // since the two password fields are never echoed back and so have to be
    // retyped on every failed attempt.
    if (!parsed.success || customFieldValuesErrors.length > 0) {
      // Surfaced per field so a mismatched password confirmation — the one
      // failure the participant can't locate from a generic message —
      // points at the field that caused it. The custom fields' messages are
      // keyed by their namespaced control names, so they can't collide with
      // the schema's.
      const fieldErrors: EntryFieldErrors = {
        ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
        ...customFieldErrors(customFieldValuesErrors, formFieldDefs),
      };
      return fail(400, {
        error: '入力内容を確認してください',
        fieldErrors,
        values,
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.tournaments[':tournamentId'].entries.$post(
      {param: {tournamentId: tournament.id}, json: parsed.data},
      {headers: {[TURNSTILE_TOKEN_FIELD]: turnstileToken}},
    );
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
