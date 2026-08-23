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

# start the frontend dev server (from the repo root)
bun run dev:frontend
```

## Building

To create a production version of your app (from the repo root):

```sh
bun --filter ./apps/frontend build
```

You can preview the production build with `bun --filter ./apps/frontend preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
