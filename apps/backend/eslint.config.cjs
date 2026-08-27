const {defineConfig} = require('eslint/config');

module.exports = defineConfig([
  // `.wrangler/**` is `wrangler dev`'s build output — tens of thousands of
  // lines of bundled code that lint has nothing to say about. It only exists
  // once someone has run the Worker locally, which is why CI never trips on
  // it. Matches `apps/frontend/eslint.config.cjs`.
  {ignores: ['dist/**', '.wrangler/**']},
  ...require('gts'),
]);
