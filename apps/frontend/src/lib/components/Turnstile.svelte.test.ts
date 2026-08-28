import {render} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';
import Turnstile from './Turnstile.svelte';

// The site key `vitest-setup-client.ts` stands in for `$env/dynamic/public`
// with: Cloudflare's published "always passes" test key.
const SITE_KEY = '1x00000000000000000000AA';

describe('Turnstile', () => {
  it('renders the container the API script looks for', () => {
    const {container} = render(Turnstile);

    const widget = container.querySelector('.cf-turnstile');
    // Both are Cloudflare's contract rather than this project's markup: the
    // class is what the script scans for, and the site key is what tells it
    // which widget to render.
    expect(widget).not.toBeNull();
    expect(widget).toHaveAttribute('data-sitekey', SITE_KEY);
  });

  it('renders the widget itself when the API script has already loaded', () => {
    // What a client-side navigation onto the form looks like: the script's
    // one scan for `.cf-turnstile` ran long before this container existed,
    // so nothing would render without this call.
    const turnstileRender = vi.fn();
    vi.stubGlobal('turnstile', {render: turnstileRender});

    try {
      const {container} = render(Turnstile);

      expect(turnstileRender).toHaveBeenCalledWith(
        container.querySelector('.cf-turnstile'),
        {sitekey: SITE_KEY},
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
