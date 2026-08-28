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

  it('resets the widget it rendered by its id', async () => {
    // What a rejected submission has to do before the participant can try
    // again: the token in the form was spent verifying the submission that
    // was just refused, and only a fresh challenge produces another one.
    const turnstileReset = vi.fn();
    vi.stubGlobal('turnstile', {
      render: vi.fn(() => 'widget-1'),
      reset: turnstileReset,
    });

    try {
      const {component} = render(Turnstile);
      component.reset();

      expect(turnstileReset).toHaveBeenCalledWith('widget-1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resets a widget it has no id for by its container', async () => {
    // The implicit render -- the API script filling the container on its own
    // during its one scan -- hands back no widget id, so the container is the
    // only handle there is. Every full page load onto the form goes this way.
    const turnstileReset = vi.fn();
    vi.stubGlobal('turnstile', {
      render: vi.fn(() => undefined),
      reset: turnstileReset,
    });

    try {
      const {component, container} = render(Turnstile);
      component.reset();

      expect(turnstileReset).toHaveBeenCalledWith(
        container.querySelector('.cf-turnstile'),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
