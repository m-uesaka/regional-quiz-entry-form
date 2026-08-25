#!/usr/bin/env bash

# ./find-pr-comments.sh <pr-number>
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <pr-number>" >&2
    exit 1
fi

PR="$1"
# Automatically obtain the repository information
OWNER="$(gh repo view --json owner -q .owner.login)"
REPO="$(gh repo view --json name -q .name)"

QUERY='
  query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            isResolved
            comments(first: 10) {
              nodes {
                databaseId
                path
                line
                originalLine
                body
                author { login }
              }
            }
          }
        }
      }
    }
  }
'

# Paginate reviewThreads so PRs with more than 100 threads are covered fully.
ALL_THREADS="[]"
CURSOR=""
while :; do
    ARGS=(-f query="$QUERY" -f owner="$OWNER" -f repo="$REPO" -F pr="$PR")
    [[ -n "$CURSOR" ]] && ARGS+=(-f cursor="$CURSOR")
    PAGE="$(gh api graphql "${ARGS[@]}")"
    PAGE_THREADS="$(echo "$PAGE" | jq -c '.data.repository.pullRequest.reviewThreads.nodes')"
    ALL_THREADS="$(jq -c -n --argjson a "$ALL_THREADS" --argjson b "$PAGE_THREADS" '$a + $b')"
    HAS_NEXT="$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')"
    [[ "$HAS_NEXT" == "true" ]] || break
    CURSOR="$(echo "$PAGE" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')"
done

# formatting (long comment bodies are truncated to keep context usage bounded)
echo "$ALL_THREADS" | jq -r '
  .[] |
  select(.isResolved == false) |
  .comments.nodes[0] |
  "[\(.author.login)] \(.path):\(.line // .originalLine) (id: \(.databaseId))\n  \(if (.body | length) > 800 then .body[0:800] + "...(truncated)" else .body end)\n"
'
