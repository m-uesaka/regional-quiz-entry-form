/**
 * @fileoverview The entry point Hono CLI (`@hono/cli`) loads for the
 * commands that read the app's routes on Node.js -- `hono routes` and
 * `hono snapshot` (#275).
 *
 * The CLI takes the module's default export as the Hono app, and
 * `src/index.ts` cannot give it one: its default export is the Worker itself,
 * `{fetch, queue}`, because a Worker with a queue consumer has to export the
 * `queue` handler alongside `fetch`. This file re-exports the app by default
 * instead. Nothing imports it, and `wrangler.toml` still points at
 * `src/index.ts`, so it is never part of the deployed Worker.
 *
 * The default export goes against the style guide's no-default-export rule;
 * the CLI requires it, the same way SvelteKit requires one for its route
 * files. `hono request` and `hono batch` do not need this file: they run the
 * Worker from `wrangler.toml` with `--runtime workerd`. See the root
 * `CLAUDE.md` for the commands.
 */

import {app} from './index';

export default app;
