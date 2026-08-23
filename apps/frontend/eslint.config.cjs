const {defineConfig} = require('eslint/config');

module.exports = defineConfig([
  {
    ignores: [
      '.svelte-kit/**',
      '.wrangler/**',
      'build/**',
      'worker-configuration.d.ts',
      'src/**/*.svelte',
    ],
  },
  ...require('gts'),
]);
