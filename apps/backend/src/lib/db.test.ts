import {describe, expect, it} from 'bun:test';
import {createDbClient} from './db';
import type {Bindings} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

describe('createDbClient', () => {
  it('returns a client', () => {
    const env: Bindings = {
      ...PERMISSIVE_PLATFORM_BINDINGS,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
      MAIL_API_KEY: 'dummy-mail-api-key',
      GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
      MAIL_FROM_ADDRESS: 'entry@example.com',
      FRONTEND_URL: 'https://entry.example.com',
      SESSION_SECRET: 'dummy-session-secret',
    };

    const client = createDbClient(env);

    expect(client).toBeDefined();
  });
});
