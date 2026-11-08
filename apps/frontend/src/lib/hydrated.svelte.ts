/**
 * Whether the client bundle has taken the component over.
 *
 * `current` is `false` in the server-rendered HTML (effects never run on the
 * server) and for as long as scripting hasn't started, and becomes `true`
 * once the component has mounted in the browser. Use it for markup that only
 * works with scripting -- controls that need a handler, or a constraint only
 * a re-render can lift again -- so that a visitor with JS off gets a page
 * that works without it.
 *
 * Create it while the component initialises (at the top level of its
 * `<script>`), as with any `$effect`.
 */
export class Hydrated {
  private hydrated = $state(false);

  constructor() {
    $effect(() => {
      this.hydrated = true;
    });
  }

  /** `true` once the component has mounted in the browser. */
  get current(): boolean {
    return this.hydrated;
  }
}
