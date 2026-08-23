import {defineConfig} from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import {sveltekit} from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({filename}) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      adapter: adapter(),
    }),
  ],
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
});
