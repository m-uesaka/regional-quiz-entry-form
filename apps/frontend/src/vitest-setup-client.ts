import {cleanup} from '@testing-library/svelte';
import {afterEach, vi} from 'vitest';
import '@testing-library/jest-dom/vitest';

// `$env/dynamic/public` is a SvelteKit virtual module that reads values the
// server put on the page at request time. Nothing does that here, so
// importing it in a component test throws before the component renders; the
// value it stands in for is supplied instead.
//
// The site key is Cloudflare's published "always passes" test key, the same
// one `.env.example` carries, so a component test sees the widget's markup
// exactly as a developer running `vite dev` does.
vi.mock('$env/dynamic/public', () => ({
  env: {PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA'},
}));

afterEach(() => {
  cleanup();
});
