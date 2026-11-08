import {flushSync} from 'svelte';
import {afterEach, describe, expect, it} from 'vitest';
import {Hydrated} from './hydrated.svelte';

describe('Hydrated', () => {
  let destroy: (() => void) | undefined;

  afterEach(() => {
    destroy?.();
    destroy = undefined;
  });

  it('reports false until its effect has run, then true', () => {
    // `$effect.root` stands in for a component's initialisation, which is
    // where the helper is meant to be created.
    let hydrated!: Hydrated;
    destroy = $effect.root(() => {
      hydrated = new Hydrated();
    });

    expect(hydrated.current).toBe(false);

    flushSync();

    expect(hydrated.current).toBe(true);
  });

  it('updates what is derived from it', () => {
    let label!: () => string;
    destroy = $effect.root(() => {
      const hydrated = new Hydrated();
      const derived = $derived(hydrated.current ? 'script' : 'plain');
      label = () => derived;
    });

    expect(label()).toBe('plain');

    flushSync();

    expect(label()).toBe('script');
  });
});
