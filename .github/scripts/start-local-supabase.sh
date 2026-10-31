#!/usr/bin/env bash
# Brings up the throwaway local Supabase stack a CI job tests against and
# exports its secret key, for the two jobs in `ci.yml` that need one. Run from
# the repository root, with the `supabase` CLI on PATH.
#
# Applies every migration in `supabase/migrations`. `apps/e2e` seeds the stack
# and talks to it over the Data API; the backend's integration tests use the
# Data API too, and Postgres directly.
#
# Only Postgres and the Data API (Kong + PostgREST) are needed: neither the
# specs nor the integration tests touch `supabase.auth`/`.storage`/realtime,
# sessions are self-issued JWTs (`apps/e2e/support/env.ts`) and mail is stubbed
# (`apps/e2e/support/mail-sink.ts`, or a `fetch` stub in the backend's tests).
# Not pulling the rest is most of the wall clock here.
#
# Two mechanisms, and they are not interchangeable. auth/storage/realtime are
# off in `supabase/config.toml`, because `-x` does NOT stop the CLI pulling
# their images to run their schema migrations (~40s here). They are
# deliberately absent from the list below, so that re-enabling one in
# `config.toml` restores it here too instead of silently reintroducing that
# pull.
#
# `-x` covers only services that stay enabled for local use. The CLI does not
# need their images to bring the stack up, so listing them skips the pull.
# Names are CLI identifiers and have been renamed upstream before (`inbucket`
# -> `mailpit`); an unknown name is ignored silently rather than erroring, so a
# rename would show up as this step getting slower again, not as a failure.
#
# The images are pulled from GHCR first. The CLI's default is public.ecr.aws,
# whose anonymous quota is shared by everything on the runner's egress IP: in
# most runs it answered every pull with `toomanyrequests: Data limit exceeded`,
# and the CLI retried for ~15s before falling back to GHCR, where the images
# came from anyway. `SUPABASE_INTERNAL_IMAGE_REGISTRY` names GHCR up front and
# skips that dead time, but it also makes GHCR the *only* registry the CLI
# tries (2.115.0 drops its ECR -> GHCR -> Docker Hub list once the variable is
# set). So a failed start is retried once without it, giving back that whole
# list at the cost of the old delay. The variable is set on the first attempt
# only, not job-wide, so nothing else loses the fallback. If an upgrade stops
# honouring it, the symptom is the ECR retries reappearing at the top of the
# `supabase start` log, not a failure.
set -eu

excluded=mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

supabase_status=0
SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io supabase start -x "$excluded" \
  || supabase_status=$?
if [ "$supabase_status" -ne 0 ]; then
  echo "::warning::supabase start from GHCR failed (exit $supabase_status); retrying with the CLI's default registry list"
  # Clears whatever the failed attempt left half-started, so the retry does not
  # trip over its containers.
  supabase stop --no-backup || true
  supabase start -x "$excluded"
fi

# Prefer the stack's own key over the default the test code falls back to, so
# a CLI that issues a different one still works. Newer CLIs print a secret key;
# older ones only the legacy service role key, which the API accepts as well.
# If `status` names neither, the fallback is left to apply rather than failing
# the job here.
status=$(supabase status -o env)
key=$(printf '%s\n' "$status" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
if [ -z "$key" ]; then
  key=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
fi
if [ -n "$key" ]; then
  echo "SUPABASE_SECRET_KEY=$key" >> "$GITHUB_ENV"
fi
