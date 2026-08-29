import {error, fail, redirect} from '@sveltejs/kit';
import {
  RegionCreateInputSchema,
  RegionUpdateInputSchema,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import type {Actions, PageServerLoad} from './$types';

/** Per-field validation messages, keyed by the control's name. */
type RegionFieldErrors = Record<string, string[] | undefined>;

/** The controls of either form on this screen. */
interface RegionFormValues {
  slug: string;
  name: string;
  allowsDualEntry: boolean;
}

/**
 * What both actions hand back. Every branch carries the same properties —
 * including the successful one — so the page can read `form.error` without
 * first narrowing across the union SvelteKit builds from the two actions.
 */
interface RegionsActionResult {
  /**
   * Which form the result belongs to, so a message lands above the form that
   * was actually submitted.
   */
  intent: 'create' | 'update';
  /** The region an `update` result belongs to; null for the create form. */
  regionId: string | null;
  saved: boolean;
  error: string | null;
  fieldErrors: RegionFieldErrors;
  /** Echoed back so a rejected submission re-renders what was typed. */
  values: RegionFormValues;
}

const EMPTY_VALUES: RegionFormValues = {
  slug: '',
  name: '',
  allowsDualEntry: false,
};

const INVALID_INPUT_MESSAGE = '入力内容を確認してください';

/** Nothing to attach per control — the refusal is about the request itself. */
const NO_FIELD_ERRORS: RegionFieldErrors = {};

export const load: PageServerLoad = async ({fetch, url}) => {
  const res = await createApiClient(fetch).api.regions.$get();
  if (!res.ok) {
    // The layout guard cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend.
    if (isUnauthorized(res)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, '地域の取得に失敗しました');
  }
  return {regions: await res.json()};
};

export const actions = {
  create: async ({request, fetch, url}) => {
    const formData = await request.formData();
    const values: RegionFormValues = {
      slug: readString(formData, 'slug'),
      name: readString(formData, 'name'),
      // An unchecked checkbox submits nothing at all, which is the `false`
      // the API's own default already assumes.
      allowsDualEntry: formData.get('allowsDualEntry') !== null,
    };

    const parsed = RegionCreateInputSchema.safeParse(values);
    if (!parsed.success) {
      // `RegionSlugSchema` spells out the slug rules in Japanese, so the
      // schema's own messages are shown rather than a generic per-field one.
      return createFailure(
        400,
        values,
        INVALID_INPUT_MESSAGE,
        parsed.error.flatten().fieldErrors as RegionFieldErrors,
      );
    }

    const res = await createApiClient(fetch).api.regions.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirect(303, staffLoginPath(url));
      }
      // The API answers 409 for exactly one reason — the slug is taken —
      // and says so in English, so the message is written here and attached
      // to the control the staff member has to change.
      if (res.status === 409) {
        return createFailure(409, values, INVALID_INPUT_MESSAGE, {
          slug: ['この slug は既に使われています'],
        });
      }
      return createFailure(
        502,
        values,
        '地域の作成に失敗しました',
        NO_FIELD_ERRORS,
      );
    }

    // The list is re-read by `load` after the action, so the created region
    // appears without this having to carry it; the create form is reset by
    // handing back empty values instead of what was just saved.
    return {
      intent: 'create',
      regionId: null,
      saved: true,
      error: null,
      fieldErrors: NO_FIELD_ERRORS,
      values: EMPTY_VALUES,
    } satisfies RegionsActionResult;
  },

  update: async ({request, fetch, url}) => {
    const formData = await request.formData();
    const regionId = readString(formData, 'id');
    // `slug` is fixed at creation time (it is already part of published
    // entry-form URLs), so the row's form carries no control for it.
    const values: RegionFormValues = {
      slug: '',
      name: readString(formData, 'name'),
      allowsDualEntry: formData.get('allowsDualEntry') !== null,
    };

    const parsed = RegionUpdateInputSchema.safeParse({
      name: values.name,
      allowsDualEntry: values.allowsDualEntry,
    });
    if (!parsed.success) {
      return updateFailure(
        400,
        regionId,
        values,
        INVALID_INPUT_MESSAGE,
        parsed.error.flatten().fieldErrors as RegionFieldErrors,
      );
    }

    const res = await createApiClient(fetch).api.regions[':id'].$patch({
      param: {id: regionId},
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirect(303, staffLoginPath(url));
      }
      if (res.status === 404) {
        return updateFailure(
          404,
          regionId,
          values,
          '地域が見つかりません',
          NO_FIELD_ERRORS,
        );
      }
      return updateFailure(
        502,
        regionId,
        values,
        '地域の更新に失敗しました',
        NO_FIELD_ERRORS,
      );
    }

    return {
      intent: 'update',
      regionId,
      saved: true,
      error: null,
      fieldErrors: NO_FIELD_ERRORS,
      values,
    } satisfies RegionsActionResult;
  },
} satisfies Actions;

/**
 * Refuses a create, marking the offending controls.
 * @param status The status to answer with.
 * @param values What was submitted, to re-render.
 * @param message The message to show above the form.
 * @param fieldErrors The messages to attach per control.
 */
function createFailure(
  status: number,
  values: RegionFormValues,
  message: string,
  fieldErrors: RegionFieldErrors,
) {
  return fail(status, {
    intent: 'create',
    regionId: null,
    saved: false,
    error: message,
    fieldErrors,
    values,
  } satisfies RegionsActionResult);
}

/**
 * Refuses an update of one region.
 * @param status The status to answer with.
 * @param regionId The region whose row the message belongs above.
 * @param values What was submitted, to re-render.
 * @param message The message to show for the row.
 * @param fieldErrors The messages to attach per control.
 */
function updateFailure(
  status: number,
  regionId: string,
  values: RegionFormValues,
  message: string,
  fieldErrors: RegionFieldErrors,
) {
  return fail(status, {
    intent: 'update',
    regionId,
    saved: false,
    error: message,
    fieldErrors,
    values,
  } satisfies RegionsActionResult);
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
