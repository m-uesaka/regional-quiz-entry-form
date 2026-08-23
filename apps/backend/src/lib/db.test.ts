import {describe, expect, it} from 'bun:test';
import {createDbClient} from './db';
import type {Bindings} from '../types/env';

describe('createDbClient', () => {
  it('returns a client', () => {
    const env: Bindings = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
      MAIL_API_KEY: 'dummy-mail-api-key',
      MAIL_FROM_ADDRESS: 'entry@example.com',
      FRONTEND_URL: 'https://entry.example.com',
      SESSION_SECRET: 'dummy-session-secret',
    };

    const client = createDbClient(env);

    expect(client).toBeDefined();
  });
});
