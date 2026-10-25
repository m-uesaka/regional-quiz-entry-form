import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError} from '@sveltejs/kit';
import type {Region, Tournament} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000011',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};

function tournament(id: string, type: Tournament['type']): Tournament {
  return {
    id,
    regionId: TOKYO.id,
    type,
    name: `大会${id.slice(-1)}`,
    capacity: null,
    entryOpensAt: '2026-01-01T00:00:00.000Z',
    entryClosesAt: '2026-02-01T00:00:00.000Z',
  };
}

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

const fakeCookies = () => ({delete: () => {}}) as unknown as Cookies;

function buildLoadEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL('http://localhost/admin/tournaments/order'),
  } as Parameters<typeof load>[0];
}

function buildActionEvent(
  fetchImpl: typeof fetch,
  formData: FormData,
): Parameters<typeof actions.default>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL('http://localhost/admin/tournaments/order'),
    request: {formData: async () => formData},
  } as Parameters<typeof actions.default>[0];
}

/**
 * The form as the page renders it: one row per id, in this order, with
 * the given "表示順" values.
 */
function orderForm(rows: Array<[id: string, order: string]>): FormData {
  const formData = new FormData();
  rows.forEach(([id, order], index) => {
    formData.set(`tournaments[${index}].id`, id);
    formData.set(`tournaments[${index}].order`, order);
  });
  return formData;
}

/** Answers the PUT with `response`, recording each request body. */
function fakePut(
  bodies: unknown[],
  response: () => Response = () => new Response(null, {status: 204}),
): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return response();
  }) as typeof fetch;
}

describe('admin tournament order +page.server load', () => {
  it('lists the tournaments in the order the API set, with their region', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) =>
      String(input instanceof Request ? input.url : input).includes('/regions')
        ? jsonResponse([TOKYO])
        : jsonResponse([
            tournament(B, 'shinjinou'),
            tournament(A, 'saikyoi'),
          ])) as typeof fetch;

    const data = await load(buildLoadEvent(fetchImpl));

    expect(data?.tournaments).toEqual([
      {id: B, regionName: '東京', typeLabel: '新人王', name: '大会b'},
      {id: A, regionName: '東京', typeLabel: '最強位', name: '大会a'},
    ]);
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = (async () =>
      jsonResponse({error: 'nope'}, 500)) as unknown as typeof fetch;

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});

describe('admin tournament order +page.server action', () => {
  it('saves the ids in the order their 表示順 asks for', async () => {
    const bodies: unknown[] = [];
    const formData = orderForm([
      [A, '1'],
      [B, '2'],
      [C, '1'],
    ]);

    const result = await actions.default(
      buildActionEvent(fakePut(bodies), formData),
    );

    expect(result).toEqual({saved: true, error: null});
    expect(bodies).toEqual([{tournamentIds: [C, A, B]}]);
  });

  it("shows the API's reason when the tournaments changed meanwhile", async () => {
    const result = await actions.default(
      buildActionEvent(
        fakePut([], () =>
          jsonResponse({error: '大会が追加または削除されました'}, 409),
        ),
        orderForm([[A, '1']]),
      ),
    );

    expect(result).toMatchObject({
      status: 409,
      data: {saved: false, error: '大会が追加または削除されました'},
    });
  });

  it('reports any other failure as a failed save', async () => {
    const result = await actions.default(
      buildActionEvent(
        fakePut([], () => jsonResponse({error: 'boom'}, 500)),
        orderForm([[A, '1']]),
      ),
    );

    expect(result).toMatchObject({
      status: 502,
      data: {saved: false, error: '表示順の保存に失敗しました'},
    });
  });

  it('refuses an empty form without calling the API', async () => {
    const bodies: unknown[] = [];

    const result = await actions.default(
      buildActionEvent(fakePut(bodies), new FormData()),
    );

    expect(result).toMatchObject({status: 400});
    expect(bodies).toEqual([]);
  });
});
