# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.17.0 create --template minimal --types ts --add vitest="usages:unit" sveltekit-adapter="adapter:cloudflare+cfTarget:pages" --no-install frontend
```

## Developing

This package is part of a Bun workspace monorepo. Install dependencies and run scripts from the
repository root with Bun, not `npm`/`pnpm`/`yarn` from within this directory — running a different
package manager here would create a second lockfile and bypass the root workspace scripts.

```sh
bun install

# the dev server needs to know where the backend is (see below)
cp apps/frontend/.env.example apps/frontend/.env

# start the backend and the frontend dev server (from the repo root, in
# separate shells)
bun run dev:backend
bun run dev:frontend
```

### Reaching the backend API

This package has no API routes of its own: `$lib/api.ts` builds relative
`/api/*` URLs and something has to route them to `apps/backend`. `BACKEND_URL`
(see `.env.example`) is that backend origin, and it is consumed in two places
because the two call sites take different routes:

| Caller | Wiring |
| --- | --- |
| `load` / `actions` (SSR) | `handleFetch` in `src/hooks.server.ts`. SvelteKit's `event.fetch` short-circuits same-origin requests into its own router instead of the network, so the rewrite has to happen in the hook; it also re-attaches the incoming cookies, which SvelteKit only forwards to the app's own host and its subdomains. |
| The browser (CSV download links, client-side `createApiClient()`) | `server.proxy` in `vite.config.ts` for `vite dev`. In production the same-origin `/api/*` prefix is routed to the backend Worker by Cloudflare (Task 8-2 / #42), not by this app. |

## Building

To create a production version of your app (from the repo root):

```sh
bun --filter ./apps/frontend build
```

You can preview the production build with `bun --filter ./apps/frontend preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
