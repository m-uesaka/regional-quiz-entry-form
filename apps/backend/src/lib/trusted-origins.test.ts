import {describe, expect, it} from 'bun:test';
import {testBindings} from '../test-support/bindings';
import {trustedHostnames, trustedOrigins} from './trusted-origins';

describe('trustedOrigins / trustedHostnames', () => {
  it('takes FRONTEND_URL and every CSRF_TRUSTED_ORIGINS entry, skipping junk', () => {
    const env = testBindings({
      FRONTEND_URL: 'https://entry.example.com/',
      CSRF_TRUSTED_ORIGINS:
        'http://127.0.0.1:5173, not a url ,http://localhost:5173/x',
    });

    expect([...trustedOrigins(env)].sort()).toEqual([
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'https://entry.example.com',
    ]);
    // Turnstile names the host only, without the scheme or the port.
    expect([...trustedHostnames(env)].sort()).toEqual([
      '127.0.0.1',
      'entry.example.com',
      'localhost',
    ]);
  });
});
