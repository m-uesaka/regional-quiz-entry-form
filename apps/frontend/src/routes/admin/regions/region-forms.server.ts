import {invalid, type Cookies} from '@sveltejs/kit';
import {
  RegionCreateInputSchema,
  RegionSchema,
  type RegionCreateInput,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized, readErrorMessage} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';

// What the two remote forms in `regions.remote.ts` do once their input has
// passed its schema. Kept out of that file because a remote module may only
// export remote functions, and these are plain functions so that they can be
// called from a test without a request to run in.

/**
 * The controls of one region's row. `id` travels as a hidden control so a
 * submission made without JavaScript still says which region it is for.
 *
 * Unlike `RegionUpdateInputSchema`, neither editable field is optional: the
 * row always posts both, and an unchecked box posts nothing at all, which
 * `allowsDualEntry`'s default reads as the `false` it means.
 */
export const RegionRowSchema = RegionCreateInputSchema.pick({
  name: true,
  allowsDualEntry: true,
}).extend({id: RegionSchema.shape.id});

/** What a row submits, once `RegionRowSchema` has filled in its default. */
type RegionRowInput = ReturnType<typeof RegionRowSchema.parse>;

/** The parts of the request a handler needs to call the API as the staff. */
export interface StaffRequest {
  fetch: typeof fetch;
  cookies: Cookies;
  /** The page the form was submitted from, for the way back after a login. */
  url: URL;
}

/** An issue attached to one control, as `invalid()` takes it. */
type FieldIssue = Exclude<Parameters<typeof invalid>[number], string>;

/** Builds the issues of the create form's controls that the API can refuse. */
interface CreateRegionIssues {
  slug(message: string): FieldIssue;
}

/** What a form hands back when it saved. */
interface Saved {
  saved: true;
}

/**
 * Creates a region.
 * @param request The staff member's request.
 * @param input The submitted region.
 * @param issue Builds the issue for a control the API refused.
 * @throws What `invalid()` throws when the API refuses the region.
 */
export async function submitNewRegion(
  {fetch, cookies, url}: StaffRequest,
  input: RegionCreateInput,
  issue: CreateRegionIssues,
): Promise<Saved> {
  const res = await createApiClient(fetch).api.regions.$post({json: input});
  if (!res.ok) {
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    // The API answers 409 for exactly one reason — the slug is taken — and
    // says so in English, so the message is written here and attached to
    // the control the staff member has to change.
    if (res.status === 409) {
      invalid(issue.slug('この slug は既に使われています'));
    }
    invalid('地域の作成に失敗しました');
  }
  return {saved: true};
}

/**
 * Updates one region's name and dual-entry setting.
 * @param request The staff member's request.
 * @param input The submitted row.
 * @throws What `invalid()` throws when the API refuses the update.
 */
export async function submitRegionRow(
  {fetch, cookies, url}: StaffRequest,
  {id, ...json}: RegionRowInput,
): Promise<Saved> {
  const res = await createApiClient(fetch).api.regions[':id'].$patch({
    param: {id},
    json,
  });
  if (!res.ok) {
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    if (res.status === 404) {
      invalid('地域が見つかりません');
    }
    // 409: allowing dual entry where 最強位 and 新人王 share a question set
    // (0045), which the API words in Japanese itself.
    if (res.status === 409) {
      invalid(await readErrorMessage(res, '地域の更新に失敗しました'));
    }
    invalid('地域の更新に失敗しました');
  }
  return {saved: true};
}
