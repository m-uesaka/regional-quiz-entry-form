import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {TournamentDetail} from '@regional-quiz/shared';
import {fakeCookies} from '../../test-support/fake-cookies';
import {fakeFetch, type RecordedRequest} from '../../test-support/fake-fetch';
import {STAFF_SESSION_COOKIE} from './staff-session';
import {
  fetchTournamentById,
  parseTournamentId,
  type TournamentByIdRouteEvent,
} from './tournament-by-id';

const TOURNAMENT_ID = '00000000-0000-0000-0000-000000000001';

const DETAIL: TournamentDetail = {
  tournament: {
    id: TOURNAMENT_ID,
    regionId: '00000000-0000-0000-0000-000000000002',
    type: 'saikyoi',
    name: 'テスト大会',
    capacity: null,
    entryOpensAt: '2020-01-01T00:00:00.000Z',
    entryClosesAt: '2099-01-01T00:00:00.000Z',
    entriesPaused: false,
    questionSet: null,
  },
  customName: null,
  formFieldDefs: [],
};

const PAGE_URL = `http://localhost/admin/tournaments/${TOURNAMENT_ID}/edit`;

const FAILURE_MESSAGE = '大会情報の取得に失敗しました';

/** Builds the event `fetchTournamentById` reads, and what it recorded. */
function buildEvent(options: {status?: number; body?: unknown; id?: string}): {
  event: TournamentByIdRouteEvent;
  requests: RecordedRequest[];
  deleted: string[];
} {
  const requests: RecordedRequest[] = [];
  const deleted: string[] = [];
  const event: TournamentByIdRouteEvent = {
    params: {id: options.id ?? TOURNAMENT_ID},
    fetch: fakeFetch(
      [
        {
          method: 'GET',
          url: new RegExp(`^/api/tournaments/${TOURNAMENT_ID}$`),
          status: options.status ?? 200,
          body: options.body ?? DETAIL,
        },
      ],
      requests,
    ),
    cookies: fakeCookies(deleted),
    url: new URL(PAGE_URL),
  };
  return {event, requests, deleted};
}

describe('parseTournamentId', () => {
  it('passes a UUID through', () => {
    expect(parseTournamentId(TOURNAMENT_ID)).toBe(TOURNAMENT_ID);
  });

  it('throws 404 for an id that is not a UUID', () => {
    expect(() => parseTournamentId('not-a-uuid')).toThrow(
      expect.objectContaining({
        status: 404,
        body: {message: '大会が見つかりません'},
      } satisfies Partial<HttpError>),
    );
  });
});

describe('fetchTournamentById', () => {
  it('returns the tournament the id names', async () => {
    const {event, requests} = buildEvent({});

    await expect(
      fetchTournamentById(event, {failureMessage: FAILURE_MESSAGE}),
    ).resolves.toEqual(DETAIL);
    expect(requests).toEqual([
      {
        method: 'GET',
        url: `/api/tournaments/${TOURNAMENT_ID}`,
        body: undefined,
      },
    ]);
  });

  it('throws 404 without asking the backend when the id is not a UUID', async () => {
    const {event, requests} = buildEvent({id: 'not-a-uuid'});

    await expect(
      fetchTournamentById(event, {failureMessage: FAILURE_MESSAGE}),
    ).rejects.toMatchObject({
      status: 404,
      body: {message: '大会が見つかりません'},
    } satisfies Partial<HttpError>);
    expect(requests).toEqual([]);
  });

  it('throws 404 when the backend has no such tournament', async () => {
    const {event} = buildEvent({status: 404, body: {error: 'not found'}});

    await expect(
      fetchTournamentById(event, {failureMessage: FAILURE_MESSAGE}),
    ).rejects.toMatchObject({
      status: 404,
      body: {message: '大会が見つかりません'},
    } satisfies Partial<HttpError>);
  });

  it('drops the staff session and redirects to log in on a 401', async () => {
    const {event, deleted} = buildEvent({
      status: 401,
      body: {error: 'unauthorized'},
    });

    await expect(
      fetchTournamentById(event, {failureMessage: FAILURE_MESSAGE}),
    ).rejects.toMatchObject({
      status: 303,
      location: `/staff/login?redirectTo=${encodeURIComponent(
        `/admin/tournaments/${TOURNAMENT_ID}/edit`,
      )}`,
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual([STAFF_SESSION_COOKIE]);
  });

  // Every page under `/admin/tournaments/[id]` is for general staff, whom
  // the read never refuses, so a 403 is no more expected than a 500.
  it.each([403, 400, 500])(
    'throws 502 with the wording it is given for a %i',
    async status => {
      const {event} = buildEvent({status, body: {error: 'nope'}});

      await expect(
        fetchTournamentById(event, {failureMessage: 'レギュレーション'}),
      ).rejects.toMatchObject({
        status: 502,
        body: {message: 'レギュレーション'},
      } satisfies Partial<HttpError>);
    },
  );
});
