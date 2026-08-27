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

## Form controls are bound, not rendered from an expression

Every form control on these pages takes its starting value from `$state` that
is seeded once (`untrack(() => form?.values)` and the like) and is wired up
with `bind:value` / `bind:group`, never with a one-way `value={...}` /
`checked={...}` expression.

That is not a style preference — a one-way expression loses what the visitor
typed. Svelte's `set_value()` / `set_checked()` compare against the value they
last wrote themselves, and on the very first run (which is hydration) there is
no such value, so they always assign. Anything typed into the server-rendered
page before the client bundle took over is overwritten at that moment: an
unsubmitted form empties itself, an edit form silently rolls back to the stored
answers, and the submit that follows is then blocked by the form's own
`required` attributes. See #90.

Svelte's bindings are the supported way out: `bind_value()` and `bind_group()`
check `input.defaultValue !== input.value` (respectively `defaultChecked !==
checked`) while hydrating and adopt what the control already holds instead of
overwriting it.

`defaultValue` / `defaultChecked` fix the overwrite too, but they are dropped
by Svelte's *server* compiler — the attribute never reaches the HTML — so the
server-rendered page would come back blank. That breaks the pages that have to
work before (or without) the client bundle, e.g. the staff login form echoing a
rejected address back.

### A constraint that needs a re-render doesn't belong in the server's HTML

The same rule applies to `required`, and the one control that got it wrong was
the required multi-option checkbox group. HTML has no "at least one of this
group is checked", so `DynamicFormField.svelte` spells it as a `required` on
every box that is *dropped again* the moment one is checked — and dropping it
takes a re-render, which only the client bundle can do. Before hydration (and
with JS off), checking one box left the others carrying a `required` nothing
would ever remove, so the browser's constraint validation silently refused to
submit the form at all. See #95.

So that `required` is never rendered on the server: `hydrated` starts `false`
and an `$effect` turns it on, which puts the constraint in place only once the
form is live. What holds for everyone instead is the form action, which runs
the shared `findCustomFieldValuesErrors()` before it calls the API and files
each refusal under the offending control's own name. It reports the schema's
complaints and the custom fields' together, so a visitor who gets no
browser-side validation at all still learns everything wrong with a submission
in one round trip — which matters because the entry form never echoes the two
password fields back, and so makes them retype both on every failed attempt.

A boolean checkbox and a `radio` group keep their plain `required`: their rule
is one the browser already expresses, so it survives without a script.

## Building

To create a production version of your app (from the repo root):

```sh
bun --filter ./apps/frontend build
```

You can preview the production build with `bun --filter ./apps/frontend preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
