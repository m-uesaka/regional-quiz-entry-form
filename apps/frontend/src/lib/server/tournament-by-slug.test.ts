import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {Tournament} from '@regional-quiz/shared';
import {readErrorMessage} from '$lib/api';
import {fakeCookies} from '../../test-support/fake-cookies';
import {fakeFetch, type RecordedRequest} from '../../test-support/fake-fetch';
import {STAFF_SESSION_COOKIE} from './staff-session';
import {
  fetchTournamentBySlug,
  parseTournamentSlug,
  type TournamentRouteEvent,
} from './tournament-by-slug';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
  entriesPaused: false,
  questionSet: null,
};

const PAGE_URL = 'http://localhost/staff/tokyo/saikyoi/entries';

const FORBIDDEN_MESSAGE = 'この大会のエントリーを閲覧する権限がありません';

/** Builds the event `fetchTournamentBySlug` reads, and what it recorded. */
function buildEvent(options: {
  status?: number;
  body?: unknown;
  tournamentSlug?: string;
}): {
  event: TournamentRouteEvent;
  requests: RecordedRequest[];
  deleted: string[];
} {
  const requests: RecordedRequest[] = [];
  const deleted: string[] = [];
  const event: TournamentRouteEvent = {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: options.tournamentSlug ?? 'saikyoi',
    },
    fetch: fakeFetch(
      [
        {
          method: 'GET',
          url: /^\/api\/tournaments\/tokyo\/saikyoi$/,
          status: options.status ?? 200,
          body: options.body ?? TOURNAMENT,
        },
      ],
      requests,
    ),
    cookies: fakeCookies(deleted),
    url: new URL(PAGE_URL),
  };
  return {event, requests, deleted};
}

describe('parseTournamentSlug', () => {
  it('passes a tournament type through', () => {
    expect(parseTournamentSlug('shinjinou')).toBe('shinjinou');
  });

  it('throws 404 for a slug naming no tournament type', () => {
    expect(() => parseTournamentSlug('nope')).toThrow(
      expect.objectContaining({
        status: 404,
        body: {message: '大会が見つかりません'},
      } satisfies Partial<HttpError>),
    );
  });
});

describe('fetchTournamentBySlug', () => {
  it('returns the tournament the slugs name', async () => {
    const {event, requests} = buildEvent({});

    await expect(
      fetchTournamentBySlug(event, {forbiddenMessage: FORBIDDEN_MESSAGE}),
    ).resolves.toEqual(TOURNAMENT);
    expect(requests).toEqual([
      {method: 'GET', url: '/api/tournaments/tokyo/saikyoi', body: undefined},
    ]);
  });

  it('throws 404 without asking the backend when the slug names no tournament type', async () => {
    const {event, requests} = buildEvent({tournamentSlug: 'nope'});

    await expect(
      fetchTournamentBySlug(event, {forbiddenMessage: FORBIDDEN_MESSAGE}),
    ).rejects.toMatchObject({
      status: 404,
      body: {message: '大会が見つかりません'},
    } satisfies Partial<HttpError>);
    expect(requests).toEqual([]);
  });

  it('throws 404 when the backend has no such tournament', async () => {
    const {event} = buildEvent({status: 404, body: {error: 'not found'}});

    await expect(
      fetchTournamentBySlug(event, {forbiddenMessage: FORBIDDEN_MESSAGE}),
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
      fetchTournamentBySlug(event, {forbiddenMessage: FORBIDDEN_MESSAGE}),
    ).rejects.toMatchObject({
      status: 303,
      location: `/staff/login?redirectTo=${encodeURIComponent(
        '/staff/tokyo/saikyoi/entries',
      )}`,
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual([STAFF_SESSION_COOKIE]);
  });

  it('throws 403 with the fixed wording it is given', async () => {
    const {event} = buildEvent({status: 403, body: {error: 'forbidden'}});

    await expect(
      fetchTournamentBySlug(event, {forbiddenMessage: FORBIDDEN_MESSAGE}),
    ).rejects.toMatchObject({
      status: 403,
      body: {message: FORBIDDEN_MESSAGE},
    } satisfies Partial<HttpError>);
  });

  it('throws 403 with the wording read off the refusal', async () => {
    const {event} = buildEvent({
      status: 403,
      body: {error: 'entries_paused'},
    });

    await expect(
      fetchTournamentBySlug(event, {
        forbiddenMessage: async res =>
          `${res.status}: ${await readErrorMessage(res, '')}`,
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: {message: '403: entries_paused'},
    } satisfies Partial<HttpError>);
  });

  it('throws 502 for any other failure', async () => {
    const {event} = buildEvent({status: 500, body: {error: 'boom'}});

    await expect(
      fetchTournamentBySlug(event, {forbiddenMessage: FORBIDDEN_MESSAGE}),
    ).rejects.toMatchObject({
      status: 502,
      body: {message: '大会情報の取得に失敗しました'},
    } satisfies Partial<HttpError>);
  });
});
