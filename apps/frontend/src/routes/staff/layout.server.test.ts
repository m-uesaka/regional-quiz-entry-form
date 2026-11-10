import {describe, expect, it} from 'vitest';
import type {StaffClaims} from '@regional-quiz/shared';
import {
  GENERAL_STAFF,
  REGIONAL_STAFF,
  staffLocals,
} from '../../test-support/staff-locals';
import {
  fakeFetch,
  type FakeRoute,
  type RecordedRequest,
} from '../../test-support/fake-fetch';
import {load} from './+layout.server';

const NOTHING_PENDING: FakeRoute = {
  method: 'GET',
  url: '/api/staff/pending-invites',
  body: {scopes: []},
};

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(
  staff: StaffClaims | null,
  routes: FakeRoute[] = [NOTHING_PENDING],
  requests?: RecordedRequest[],
): Parameters<typeof load>[0] {
  return {
    locals: staffLocals(staff),
    fetch: fakeFetch(routes, requests),
  } as Parameters<typeof load>[0];
}

describe('staff +layout.server load', () => {
  it('reports no session on the login screen, without asking about invites', async () => {
    const requests: RecordedRequest[] = [];

    expect(await load(buildEvent(null, [], requests))).toEqual({
      loggedIn: false,
      isGeneralStaff: false,
    });
    expect(requests).toEqual([]);
  });

  it('marks general staff, who may open the dashboard', async () => {
    expect(await load(buildEvent(GENERAL_STAFF))).toEqual({
      loggedIn: true,
      isGeneralStaff: true,
    });
  });

  it('does not mark regional staff, whom the dashboard refuses', async () => {
    expect(await load(buildEvent(REGIONAL_STAFF))).toEqual({
      loggedIn: true,
      isGeneralStaff: false,
    });
  });

  it("warns about the address's accounts still waiting on their invite", async () => {
    expect(
      await load(
        buildEvent(REGIONAL_STAFF, [
          {...NOTHING_PENDING, body: {scopes: ['shinjinou']}},
        ]),
      ),
    ).toEqual({
      loggedIn: true,
      isGeneralStaff: false,
      pendingInvitesMessage: expect.stringMatching(
        /「新人王の地域スタッフ」.*招待メールのリンク/,
      ),
    });
  });

  // A backend without the endpoint (rolled back, or deployed behind the
  // frontend) answers 404, and one that is struggling 500; neither is a
  // reason to fail every staff page.
  it.each([404, 500])(
    'shows the page without a warning on a %i',
    async status => {
      expect(
        await load(
          buildEvent(REGIONAL_STAFF, [
            {
              method: 'GET',
              url: '/api/staff/pending-invites',
              status,
              body: {},
            },
          ]),
        ),
      ).toEqual({loggedIn: true, isGeneralStaff: false});
    },
  );

  it('shows the page without a warning on an answer it does not recognise', async () => {
    expect(
      await load(
        buildEvent(REGIONAL_STAFF, [{...NOTHING_PENDING, body: {ok: true}}]),
      ),
    ).toEqual({loggedIn: true, isGeneralStaff: false});
  });

  it('shows the page without a warning when the backend cannot be reached', async () => {
    expect(
      await load(
        buildEvent(REGIONAL_STAFF, [
          {
            url: '/api/staff/pending-invites',
            respond: () => {
              throw new TypeError('fetch failed');
            },
          },
        ]),
      ),
    ).toEqual({loggedIn: true, isGeneralStaff: false});
  });
});
