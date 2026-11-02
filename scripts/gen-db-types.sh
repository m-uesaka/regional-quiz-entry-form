#!/usr/bin/env bash
# Regenerates apps/backend/src/types/database.ts from the local Supabase
# (`bun run db:types`).
#
# Written to a temporary file and moved into place only once the generator
# succeeds: a redirect straight into the target would empty it first, so a
# failed run (the local stack not running, the postgres-meta image failing to
# pull) would leave an empty file behind for typecheck to trip over.
set -euo pipefail

out="apps/backend/src/types/database.ts"
tmp="$(mktemp "${out}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

supabase gen types typescript --local --schema public >"$tmp"
chmod 644 "$tmp"
mv "$tmp" "$out"
