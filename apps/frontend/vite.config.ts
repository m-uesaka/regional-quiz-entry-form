import {defineConfig} from 'vitest/config';
import {loadEnv} from 'vite';
import adapter from '@sveltejs/adapter-cloudflare';
import {sveltekit} from '@sveltejs/kit/vite';

// The address `wrangler dev` serves `apps/backend` on by default, used when
// `BACKEND_URL` isn't set so that `bun run dev:frontend` works out of the box.
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

export default defineConfig(({mode}) => {
  // Vite does not put unprefixed `.env` values on `process.env`, so read them
  // here to keep the dev proxy on the same `BACKEND_URL` that
  // `$env/dynamic/private` hands `handleFetch` in `src/hooks.server.ts`.
  const backendUrl = loadEnv(mode, process.cwd(), '').BACKEND_URL;

  return {
    plugins: [
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
          runes: ({filename}) =>
            filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
        },
        adapter: adapter(),
      }),
    ],
    server: {
      proxy: {
        // Requests the browser makes to `/api/*` on this origin: the CSV
        // download links and the client-side `createApiClient()` calls. In
        // production Cloudflare routes that prefix to the backend Worker (#42);
        // during `vite dev` this proxy stands in for that routing. Requests
        // made from `load`/`actions` never reach here — they go through
        // `handleFetch` in `src/hooks.server.ts` instead.
        // A key starting with `^` is compiled to a `RegExp` and matched
        // against the whole request target (query string included); a plain
        // key would be a raw prefix and would also catch `/apiece` and
        // `/api-docs`. This pattern matches exactly what `isApiPath()` in
        // `src/lib/server/backend-fetch.ts` accepts: `/api` itself and
        // `/api/...`, each with an optional `?query`.
        '^/api(?:[/?].*)?$': {
          target: backendUrl || DEFAULT_BACKEND_URL,
          changeOrigin: true,
          // A `BACKEND_URL` pointing at an HTTPS dev server (`wrangler dev
          // --local-protocol https`) is behind a self-signed certificate,
          // which is not worth failing the proxy over locally.
          secure: false,
        },
      },
    },
    test: {
      expect: {requireAssertions: true},
      projects: [
        {
          extends: './vite.config.ts',
          test: {
            name: 'server',
            environment: 'node',
            include: ['src/**/*.{test,spec}.{js,ts}'],
            exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
          },
        },
        {
          extends: './vite.config.ts',
          resolve: {
            // Resolve Svelte's browser build instead of its SSR build so
            // component tests exercise real DOM mounting/reactivity.
            conditions: ['browser'],
          },
          test: {
            name: 'client',
            environment: 'jsdom',
            include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
            setupFiles: ['./src/vitest-setup-client.ts'],
          },
        },
      ],
    },
  };
});
