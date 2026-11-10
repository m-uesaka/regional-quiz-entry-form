import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {StaffClaims} from '@regional-quiz/shared';
import {
  GENERAL_STAFF,
  REGIONAL_STAFF,
  staffLocals,
} from '../../test-support/staff-locals';
import {fakeFetch, type FakeRoute} from '../../test-support/fake-fetch';
import {load} from './+layout.server';

/** Builds the partial `RequestEvent` `load` reads, cast for test use. */
function buildEvent(
  staff: StaffClaims | null,
  scopes: string[] = [],
): Parameters<typeof load>[0] {
  const routes: FakeRoute[] = [
    {method: 'GET', url: '/api/staff/pending-invites', body: {scopes}},
  ];
  return {
    locals: staffLocals(staff),
    url: new URL('http://localhost/admin/regions'),
    fetch: fakeFetch(routes),
  } as Parameters<typeof load>[0];
}

describe('admin +layout.server load', () => {
  it('redirects an anonymous visitor to the staff login', async () => {
    await expect(load(buildEvent(null))).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fadmin%2Fregions',
    } satisfies Partial<Redirect>);
  });

  it('rejects regional staff with 403', async () => {
    await expect(load(buildEvent(REGIONAL_STAFF))).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('lets general staff through and hands the layout their claims', async () => {
    expect(await load(buildEvent(GENERAL_STAFF))).toEqual({
      staff: GENERAL_STAFF,
    });
  });

  it("warns about the address's accounts still waiting on their invite", async () => {
    expect(
      await load(buildEvent(GENERAL_STAFF, ['saikyoi', 'shinjinou'])),
    ).toEqual({
      staff: GENERAL_STAFF,
      pendingInvitesMessage: expect.stringContaining(
        '「最強位の地域スタッフ・新人王の地域スタッフ」',
      ),
    });
  });
});
