import {error, fail, isHttpError} from '@sveltejs/kit';
import {
  canPreviewTournament,
  EntryInputSchema,
  EntrySessionInputSchema,
  entryAvailability,
  findCustomFieldValuesErrors,
  TournamentEntryCountsSchema,
  TournamentTypeSchema,
  type FormFieldDef,
  type Regulation,
  type Tournament,
  type TournamentEntryCounts,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {isWaitlistOpen, priorityEntryNotices} from '$lib/priority-entry';
import {participantLoginPath} from '$lib/server/participant-login';
import {clearParticipantSession} from '$lib/server/participant-session';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import {readTurnstileToken, TURNSTILE_TOKEN_FIELD} from '$lib/turnstile';
import {
  customFieldErrors,
  entrySchemaFieldErrors,
  readCustomFieldValues,
  readFormText,
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
 * What a logged-in submission is told when its session is no longer good:
 * it expired, or it was ended by a logout or a password reset in another
 * tab while the form was open.
 */
const SESSION_EXPIRED_MESSAGE =
  'ログインの有効期限が切れました。もう一度ログインしてからエントリーしてください';

/** What a tournament staff paused (0039) is shown as, in place of its form. */
const ENTRIES_PAUSED_MESSAGE =
  'この大会のエントリー受付は現在一時中断しています。再開までしばらくお待ちください';

/**
 * The hidden field a form rendered for a logged-in participant carries.
 * It is what tells a session that lapsed while the form was open apart from
 * a visitor who was never logged in: the form it was rendered as has no
 * address or password fields to fall back on.
 */
const SESSION_ENTRY_FIELD = 'entryMode';
const SESSION_ENTRY_VALUE = 'session';

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
  // Staff paused the tournament (0039) between the action's tournament read
  // and the entry POST. A pause before that read is caught by the action
  // itself.
  'entries paused': ENTRIES_PAUSED_MESSAGE,
  'regulation not eligible in priority window':
    '現在は優先期間中のため、優先対象のレギュレーションを1つ以上選択してください',
  // Only a logged-in submission is told this: an anonymous one is answered
  // the same whatever the address, and the reason goes to its owner by mail
  // (#117).
  'already registered in another region':
    '別の地域の大会にエントリーしているため、この大会にはエントリーできません。この大会にエントリーするには、マイページで別の地域の大会のエントリーをキャンセルしてください。受付終了後にキャンセルした大会がある場合は、別の地域の大会にはエントリーできません',
  'already entered': 'この大会には既にエントリー済みです',
  // An earlier entry whose verification link is still valid (#172). Once
  // that link expires, entering again goes through.
  'entry pending verification':
    'この大会へのエントリーは確定待ちです。確認メールのリンクを開いて確定してください。メールが見当たらない場合は、マイページでこのエントリーをキャンセルしてから、もう一度エントリーしてください',
  // The regulations changed while the form was open, so what the page
  // offered no longer exists. Reloading is what fixes it.
  'regulation no longer available':
    '選択したレギュレーションが変更されました。ページを再読み込みして、もう一度お試しください',
  // Another submission for the same tournament -- from another tab, say --
  // wrote its entry first (#191). Whether that one is confirmed yet depends
  // on its mail, so the participant is sent to mypage to see which.
  'concurrent submission':
    'この大会へのエントリーが同時に送信されていました。マイページでエントリー状況をご確認ください',
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
  401: SESSION_EXPIRED_MESSAGE,
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
 * @param event The request's `params` and `fetch`, plus the `cookies` and
 *     `url` a refused staff session is cleared and redirected with.
 */
async function fetchTournament({
  params,
  fetch,
  cookies,
  url,
}: Pick<
  RequestEvent,
  'params' | 'fetch' | 'cookies' | 'url'
>): Promise<Tournament> {
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
    // A 401 means the request carried a staff cookie the gate refused: it
    // expired, or its sessions were revoked. Only staff hold that cookie, so
    // it is dropped and its holder sent to log in again, rather than told
    // the period is closed while the dead cookie stays put.
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    // The backend applies the same entry-period rule this page does
    // (`middleware/entry-period.ts`), and answers before the tournament is
    // readable at all -- so outside the period this is what a visitor with
    // no staff session, or one covering another region, actually gets.
    if (res.status === 403) {
      // A paused tournament (0039) is gated the same way, but said apart.
      throw error(
        403,
        (await readErrorCode(res)) === 'entries paused'
          ? ENTRIES_PAUSED_MESSAGE
          : 'エントリー期間外です',
      );
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

/**
 * Fetches how many entries hold a seat and how many are waiting. Only the
 * waitlist notice depends on it, so a failed read leaves the notice out
 * (logged) rather than taking the form down with it.
 * @param tournamentId The tournament the form belongs to.
 * @param fetch SvelteKit's `event.fetch`.
 */
async function fetchEntryCounts(
  tournamentId: string,
  fetch: RequestEvent['fetch'],
): Promise<TournamentEntryCounts | null> {
  const path = `GET /api/tournaments/${tournamentId}/entry-counts`;
  try {
    const api = createApiClient(fetch);
    const res = await api.api.tournaments[':tournamentId']['entry-counts'].$get(
      {param: {tournamentId}},
    );
    if (!res.ok) {
      console.error(`${path} answered ${res.status}`);
      return null;
    }
    const counts = TournamentEntryCountsSchema.safeParse(await res.json());
    if (!counts.success) {
      console.error(`${path} answered an unreadable body`, counts.error.issues);
      return null;
    }
    return counts.data;
  } catch (e: unknown) {
    // A network failure or a body that isn't JSON: still only the notice
    // is lost.
    console.error(`${path} failed`, e);
    return null;
  }
}

export const load: PageServerLoad = async ({
  params,
  fetch,
  locals,
  url,
  cookies,
}) => {
  const tournament = await fetchTournament({params, fetch, cookies, url});

  // Read once and used for the gate and everything after it, so the
  // server rendering and the hydrated page agree, and so a request that
  // straddles the closing instant can't pass the gate as a participant and
  // then be shown the staff preview notice.
  const now = new Date();
  // Taking entries: within the period and not paused by staff (0039).
  const availability = entryAvailability(tournament, now);
  const open = availability === 'open';

  // Holding *a* staff session is not enough: the requirement grants the
  // out-of-period form to the tournament's own 地域スタッフ and to 統括
  // スタッフ, not to a regional account covering somewhere else. The rule is
  // the one the backend enforces, imported rather than restated.
  if (!open && !canPreviewTournament(locals.staff, tournament)) {
    throw error(
      403,
      availability === 'paused'
        ? ENTRIES_PAUSED_MESSAGE
        : 'エントリー期間外です',
    );
  }

  // All public reads and none depends on another, so they run
  // concurrently.
  const [regulations, formFieldDefs, entryCounts] = await Promise.all([
    fetchRegulations(tournament.id, fetch),
    fetchFormFieldDefs(tournament.id, fetch),
    fetchEntryCounts(tournament.id, fetch),
  ]);
  // Both notices are about the entries the form is taking, so a form staff
  // preview outside its period shows neither -- as on the portal, where a
  // priority window can outlast its form.
  return {
    tournament,
    regulations,
    formFieldDefs,
    // Only staff get this far outside the period (checked above). The API
    // refuses their submission all the same, so the form is shown without
    // a way to send it.
    staffPreview: !open,
    // Which of the two the preview notice explains.
    staffPreviewReason: open
      ? null
      : availability === 'paused'
        ? ('paused' as const)
        : ('closed' as const),
    priorityNotices: open
      ? priorityEntryNotices(regulations, now, tournament)
      : [],
    waitlistOpen:
      open &&
      entryCounts !== null &&
      isWaitlistOpen(tournament.capacity, entryCounts),
    // A logged-in participant enters under their session, so the form
    // leaves out the address and password; anyone else is offered the login
    // screen, which brings them back here (#117).
    loggedIn: Boolean(locals.participant),
    loginPath: participantLoginPath(url.pathname),
  };
};

/**
 * What a submission echoes back with every failure, so a rejected one
 * re-renders what the participant typed. The two password fields are
 * deliberately left out: re-rendering a password into the HTML would put it
 * in the page source and in any cache of it.
 * @param formData The submitted form.
 * @param formFieldDefs The tournament's custom fields, read back by key.
 */
function readEntryFormValues(
  formData: FormData,
  formFieldDefs: FormFieldDef[],
): EntryFormValues {
  return {
    name: String(formData.get('name') ?? ''),
    furigana: String(formData.get('furigana') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    email: String(formData.get('email') ?? ''),
    // A checkbox group, so every checked box arrives under the same name —
    // `getAll`, not `get`.
    regulationIds: formData.getAll('regulationIds').map(String),
    freeText: readFormText(formData, 'freeText'),
    customFieldValues: readCustomFieldValues(formData, formFieldDefs),
  };
}

export const actions = {
  default: async ({params, request, fetch, locals, url, cookies}) => {
    const formData = await request.formData();
    let tournament: Tournament;
    try {
      tournament = await fetchTournament({params, fetch, cookies, url});
    } catch (e: unknown) {
      // Staff paused the tournament (0039) while the form was open. Said
      // with `fail()` rather than the error page `load` shows, so the
      // enhanced form stays up with what was typed in it (its controls are
      // seeded once and keep their values) and can be sent again once
      // entries resume. The field definitions are behind the same gate, so
      // the custom answers can't be read back here; the controls still
      // hold them.
      if (isHttpError(e, 403) && e.body.message === ENTRIES_PAUSED_MESSAGE) {
        return fail(403, {
          error: ENTRIES_PAUSED_MESSAGE,
          fieldErrors: {} as EntryFieldErrors,
          values: readEntryFormValues(formData, []),
          loginPath: null,
        });
      }
      throw e;
    }
    // The field definitions decide how the submitted body is interpreted,
    // so they're re-read from the API rather than trusted from the client.
    const formFieldDefs = await fetchFormFieldDefs(tournament.id, fetch);

    // Written into the form by the Turnstile widget
    // (`$lib/components/Turnstile.svelte`). Not part of the entry, so it
    // travels as a header rather than in the body the schema describes --
    // which is why it is read through a helper that refuses what a header
    // cannot carry.
    const turnstileToken = readTurnstileToken(formData);
    const values = readEntryFormValues(formData, formFieldDefs);
    const {freeText} = values;

    // Which form was submitted decides the path, not whether a session
    // exists now: a session that appeared in another tab after an anonymous
    // form was opened must not take over the address and password typed
    // into it, and one that lapsed after a logged-in form was opened leaves
    // a form with no address or password to fall back on.
    const renderedForSession =
      formData.get(SESSION_ENTRY_FIELD) === SESSION_ENTRY_VALUE;
    const loginPath = participantLoginPath(url.pathname);
    if (renderedForSession && !locals.participant) {
      return fail(401, {
        error: SESSION_EXPIRED_MESSAGE,
        fieldErrors: {} as EntryFieldErrors,
        values,
        loginPath,
      });
    }

    // The entry itself, as both schemas describe it: everything the form
    // echoes back except the address, which only an anonymous entry sends.
    const {email, ...entryValues} = values;
    const entry = {
      ...entryValues,
      freeText: freeText === '' ? undefined : freeText,
    };

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

    /**
     * The answer to a submission that failed the schema or the custom
     * fields. Both are reported together rather than the custom fields
     * short-circuiting the schema, so everything wrong with a submission
     * comes back in one round trip. That matters most for exactly the
     * participants the custom field check exists for — those submitting
     * before hydration or with JS off, who get no browser-side complaints
     * at all — since the two password fields are never echoed back and so
     * have to be retyped on every failed attempt.
     *
     * Surfaced per field so a mismatched password confirmation — the one
     * failure the participant can't locate from a generic message — points
     * at the field that caused it. The custom fields' messages are keyed by
     * their namespaced control names, so they can't collide with the
     * schema's.
     */
    const invalid = (schemaErrors: EntryFieldErrors) =>
      fail(400, {
        error: '入力内容を確認してください',
        fieldErrors: {
          ...schemaErrors,
          ...customFieldErrors(customFieldValuesErrors, formFieldDefs),
        } as EntryFieldErrors,
        values,
        loginPath: null,
      });

    const api = createApiClient(fetch);
    const headers = {[TURNSTILE_TOKEN_FIELD]: turnstileToken};
    const param = {tournamentId: tournament.id};
    // Only what the handling below reads: the two endpoints answer with
    // differently typed clients, and this is what they have in common.
    let res: {ok: boolean; status: number; json(): Promise<unknown>};
    if (renderedForSession) {
      const parsed = EntrySessionInputSchema.safeParse(entry);
      if (!parsed.success || customFieldValuesErrors.length > 0) {
        return invalid(
          parsed.success ? {} : entrySchemaFieldErrors(parsed.error.issues),
        );
      }
      res = await api.api.tournaments[':tournamentId'].entries.session.$post(
        {param, json: parsed.data},
        {headers},
      );
    } else {
      const parsed = EntryInputSchema.safeParse({
        ...entry,
        email,
        password: String(formData.get('password') ?? ''),
        passwordConfirm: String(formData.get('passwordConfirm') ?? ''),
      });
      if (!parsed.success || customFieldValuesErrors.length > 0) {
        return invalid(
          parsed.success ? {} : entrySchemaFieldErrors(parsed.error.issues),
        );
      }
      res = await api.api.tournaments[':tournamentId'].entries.$post(
        {param, json: parsed.data},
        {headers},
      );
    }

    if (!res.ok) {
      // A 401 is a session the API refused although this app still reads
      // its cookie as valid: cut by a password reset, or its participant
      // gone. The cookie is dropped here, or `/mypage/login` would see it,
      // take the visitor for logged in and send them straight back to this
      // form, which would refuse again -- for ever.
      if (res.status === 401) {
        clearParticipantSession(cookies, url);
      }
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
        loginPath: res.status === 401 ? loginPath : null,
      });
    }

    // A logged-in entry is created there and then, as `pending_verification`
    // like any other: it counts once the participant follows the link mailed
    // to their own address.
    if (renderedForSession) {
      return {submitted: true, loggedIn: true};
    }
    // An anonymous submission is answered before anything about the address
    // is known (#117): the mail that went out is either the confirmation
    // link or the reason there isn't one, and only its recipient learns
    // which. So the page says a mail was sent, not that the entry was taken.
    return {submitted: true, email};
  },
} satisfies Actions;
