const {defineConfig} = require('eslint/config');

module.exports = defineConfig([
  {ignores: ['test-results/**', 'playwright-report/**']},
  ...require('gts'),
]);
