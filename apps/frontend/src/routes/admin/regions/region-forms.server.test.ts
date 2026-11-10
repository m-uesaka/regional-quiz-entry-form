import {describe, expect, it} from 'vitest';
import {isRedirect, isValidationError} from '@sveltejs/kit';
import type {Region} from '@regional-quiz/shared';
import {fakeCookies} from '../../../test-support/fake-cookies';
import {
  fakeFetch,
  type RecordedRequest,
} from '../../../test-support/fake-fetch';
import {
  RegionRowSchema,
  submitNewRegion,
  submitRegionRow,
  type StaffRequest,
} from './region-forms.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

const OSAKA_INPUT = {slug: 'osaka', name: '大阪', allowsDualEntry: false};

/**
 * Builds a fake `fetch` answering the regions API.
 * @param options.status The status to answer a create/update with.
 * @param options.body The body to answer a refusal with.
 * @param options.calls Collects the requests sent.
 */
function fakeApi(options: {
  status?: number;
  body?: unknown;
  calls?: RecordedRequest[];
}): typeof fetch {
  const status = options.status ?? 200;
  const body = status < 400 ? TOKYO : (options.body ?? {error: 'nope'});
  return fakeFetch(
    [
      {method: 'POST', url: /^\/api\/regions$/, status, body},
      {method: 'PATCH', url: `/api/regions/${TOKYO.id}`, status, body},
    ],
    options.calls,
  );
}

/**
 * The request a handler runs in.
 * @param fetchImpl The `fetch` that reaches the API.
 * @param deleted Collects the cookies the handler deletes.
 */
function staffRequest(
  fetchImpl: typeof fetch,
  deleted: string[] = [],
): StaffRequest {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(deleted),
    url: new URL('http://localhost/admin/regions'),
  };
}

/** Builds the create form's issues the way `form()` hands them over. */
const issue = {
  slug: (message: string) => ({message, path: ['slug']}),
};

/**
 * Runs a handler that is expected to refuse, and returns the issues it
 * refused with.
 * @param run The call to make.
 */
async function issuesOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e: unknown) {
    // `isValidationError()` is typed as narrowing to something else; what it
    // recognises is the error `invalid()` throws, which carries the issues.
    if (isValidationError(e)) return (e as unknown as {issues: unknown}).issues;
    throw e;
  }
  throw new Error('expected the handler to refuse');
}

describe('submitNewRegion', () => {
  it('sends the submitted region and reports the save', async () => {
    const calls: RecordedRequest[] = [];

    await expect(
      submitNewRegion(
        staffRequest(fakeApi({status: 201, calls})),
        {...OSAKA_INPUT, allowsDualEntry: true},
        issue,
      ),
    ).resolves.toEqual({saved: true});
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/regions',
        body: {slug: 'osaka', name: '大阪', allowsDualEntry: true},
      },
    ]);
  });

  it('reports a duplicate slug on the slug field', async () => {
    const issues = await issuesOf(() =>
      submitNewRegion(staffRequest(fakeApi({status: 409})), OSAKA_INPUT, issue),
    );

    expect(issues).toEqual([
      {message: 'この slug は既に使われています', path: ['slug']},
    ]);
  });

  it('reports any other failure on the form as a whole', async () => {
    const issues = await issuesOf(() =>
      submitNewRegion(staffRequest(fakeApi({status: 500})), OSAKA_INPUT, issue),
    );

    expect(issues).toEqual([{message: '地域の作成に失敗しました'}]);
  });

  it('sends an expired session to the login screen and back', async () => {
    const deleted: string[] = [];

    const thrown = await submitNewRegion(
      staffRequest(fakeApi({status: 401}), deleted),
      OSAKA_INPUT,
      issue,
    ).catch((e: unknown) => e);

    expect(isRedirect(thrown) && thrown.location).toBe(
      '/staff/login?redirectTo=%2Fadmin%2Fregions',
    );
    expect(deleted).toEqual(['staff_session']);
  });
});

describe('submitRegionRow', () => {
  it('patches only the editable fields of the named region', async () => {
    const calls: RecordedRequest[] = [];

    await expect(
      submitRegionRow(staffRequest(fakeApi({calls})), {
        id: TOKYO.id,
        name: '東京都',
        allowsDualEntry: true,
      }),
    ).resolves.toEqual({saved: true});
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `/api/regions/${TOKYO.id}`,
        body: {name: '東京都', allowsDualEntry: true},
      },
    ]);
  });

  it('says so when the region is gone', async () => {
    const issues = await issuesOf(() =>
      submitRegionRow(staffRequest(fakeApi({status: 404})), {
        id: TOKYO.id,
        name: '東京都',
        allowsDualEntry: false,
      }),
    );

    expect(issues).toEqual([{message: '地域が見つかりません'}]);
  });

  // 0045: allowing dual entry where both tournaments share a question set.
  it("shows the API's own words for a refused dual-entry setting", async () => {
    const message =
      '重複エントリーを認める地域では、最強位と新人王に同じ問題セットを設定できません';

    const issues = await issuesOf(() =>
      submitRegionRow(
        staffRequest(fakeApi({status: 409, body: {error: message}})),
        {id: TOKYO.id, name: '東京', allowsDualEntry: true},
      ),
    );

    expect(issues).toEqual([{message}]);
  });
});

describe('RegionRowSchema', () => {
  // An unchecked box posts nothing at all.
  it('reads a missing dual-entry box as unchecked', () => {
    expect(RegionRowSchema.parse({id: TOKYO.id, name: '東京'})).toEqual({
      id: TOKYO.id,
      name: '東京',
      allowsDualEntry: false,
    });
  });

  it('refuses an id that is not a region id', () => {
    expect(RegionRowSchema.safeParse({id: 'tokyo', name: '東京'}).success).toBe(
      false,
    );
  });
});
