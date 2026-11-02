const {defineConfig} = require('eslint/config');

module.exports = defineConfig([
  // `.wrangler/**` is `wrangler dev`'s build output — tens of thousands of
  // lines of bundled code that lint has nothing to say about. It only exists
  // once someone has run the Worker locally, which is why CI never trips on
  // it. Matches `apps/frontend/eslint.config.cjs`.
  //
  // `src/types/database.ts` is written by `bun run db:types` (the Supabase
  // CLI's type generator) and committed verbatim. Linting it would mean
  // reformatting it after every regeneration, and then it would no longer be
  // byte-for-byte what the generator prints, which is what CI's drift check
  // compares against. `tsc` still checks it.
  {ignores: ['dist/**', '.wrangler/**', 'src/types/database.ts']},
  ...require('gts'),
]);
