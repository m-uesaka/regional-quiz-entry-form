import {afterEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import {parseFormDefinitionYaml} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

const SESSION_SECRET = 'test-session-secret';

const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

async function generalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '99999999-9999-9999-9999-999999999999',
      role: 'general',
      regionId: null,
      tournamentType: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

async function regionalStaffCookie(regionId: string): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

describe('sheet-import routes', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );

    expect(res.status).toBe(401);
  });

  it('rejects regional staff with 403', async () => {
    const cookie = await regionalStaffCookie(
      '11111111-1111-1111-1111-111111111111',
    );

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('rejects a body missing spreadsheetId/tournamentSlug with 400', async () => {
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 with an error message on a fetch failure', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 404}),
      )) as unknown as typeof fetch;

    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('returns 502 when Google Sheets returns a 5xx', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 503}),
      )) as unknown as typeof fetch;

    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );

    expect(res.status).toBe(502);
  });

  it('returns 502 on a network failure reaching Google Sheets', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );

    expect(res.status).toBe(502);
  });

  it('returns 503 when Google Sheets rate-limits the request', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 429}),
      )) as unknown as typeof fetch;

    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );

    expect(res.status).toBe(503);
  });

  it('returns 200 with a yaml preview for general staff', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            values: [
              [
                'agree_to_rules',
                '規約に同意する',
                'チェックボックス',
                '必須',
                '',
              ],
            ],
          }),
          {status: 200},
        ),
      )) as unknown as typeof fetch;

    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/sheet-import/preview',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          spreadsheetId: 'sheet-id',
          tournamentSlug: 'saikyoi',
        }),
      },
      env,
    );
    const body = (await res.json()) as {yaml: string};

    expect(res.status).toBe(200);
    const parsed = parseFormDefinitionYaml(body.yaml);
    expect(parsed).toEqual({
      tournamentSlug: 'saikyoi',
      fields: [
        {
          key: 'agree_to_rules',
          label: '規約に同意する',
          type: 'checkbox',
          required: true,
        },
      ],
    });
  });
});
