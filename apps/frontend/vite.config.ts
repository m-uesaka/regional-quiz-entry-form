import {defineConfig} from 'vitest/config';
import {defaultServerConditions, loadEnv} from 'vite';
import adapter from '@sveltejs/adapter-cloudflare';
import {sveltekit} from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

// The address `wrangler dev` serves `apps/backend` on by default, used when
// `BACKEND_URL` isn't set so that `bun run dev:frontend` works out of the box.
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

// The SSR build runs on Cloudflare Pages (workerd), not Node, so it resolves
// packages the way Wrangler does for `apps/backend` rather than with Vite's
// Node-first defaults. Under the `node` condition `yaml` (via
// `packages/shared`) resolves to its CommonJS build, which Rolldown wraps in
// `createRequire(import.meta.url)`; `import.meta.url` is undefined on Pages,
// so the Function fails to load at deploy time. `vite dev` and vitest run on
// Node and keep the defaults.
const WORKERD_SERVER_CONDITIONS = [
  'workerd',
  'worker',
  ...defaultServerConditions.filter(condition => condition !== 'node'),
];

export default defineConfig(({command, mode}) => {
  // Vite does not put unprefixed `.env` values on `process.env`, so read them
  // here to keep the dev proxy on the same `BACKEND_URL` that
  // `$env/dynamic/private` hands `handleFetch` in `src/hooks.server.ts`.
  const backendUrl = loadEnv(mode, process.cwd(), '').BACKEND_URL;

  return {
    plugins: [
      tailwindcss(),
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
          runes: ({filename}) =>
            filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
        },
        adapter: adapter(),
      }),
    ],
    ssr:
      command === 'build'
        ? {resolve: {conditions: WORKERD_SERVER_CONDITIONS}}
        : undefined,
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
