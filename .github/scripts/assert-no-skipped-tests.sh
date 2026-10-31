#!/usr/bin/env bash
# Fails unless a `bun test --reporter=junit` report ran tests and skipped
# none, for the `integration` job in `ci.yml`.
#
# `REQUIRE_SUPABASE_DB` only covers a suite going through `isDbReachable()`.
# A leftover `.skip`, or a suite with a condition of its own, would still exit
# 0, and a job whose whole point is that the DB suites ran can't pass on that.
#
# Usage: assert-no-skipped-tests.sh <junit report>
set -euo pipefail

report=$1
summary=$(grep -m1 '<testsuites' "$report")
tests=$(printf '%s\n' "$summary" | sed -n 's/.* tests="\([0-9]*\)".*/\1/p')
skipped=$(printf '%s\n' "$summary" | sed -n 's/.* skipped="\([0-9]*\)".*/\1/p')

if [ -z "$tests" ] || [ -z "$skipped" ]; then
  echo "::error::could not read the test counts from $report" >&2
  exit 1
fi
if [ "$tests" -eq 0 ]; then
  echo "::error::$report recorded no tests" >&2
  exit 1
fi
if [ "$skipped" -ne 0 ]; then
  echo "::error::$skipped of $tests tests were skipped" >&2
  grep -B1 '<skipped' "$report" | grep -o 'name="[^"]*"' >&2 || true
  exit 1
fi
echo "$tests tests ran, none skipped"
