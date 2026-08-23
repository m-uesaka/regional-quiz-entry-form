#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
    echo "Usage: $0 <pr-number> <comment-id> <reply-body>" >&2
    echo "  comment-id: the id printed by find-pr-comments.sh for the target comment" >&2
    exit 1
fi

PR="$1"
COMMENT_ID="$2"
BODY="$3"

OWNER="$(gh repo view --json owner -q .owner.login)"
REPO="$(gh repo view --json name -q .name)"
REPO_URL="https://github.com/${OWNER}/${REPO}"

# Commit hash -> Commit link (only the hash following "Fixed in", per the
# documented reply format "Fixed in <commit_hash>: <comments>", so unrelated
# hex-looking tokens such as dates are left untouched)
BODY="$(
    python3 - "$BODY" "$REPO_URL" <<'EOF'
import re, sys

body, repo_url = sys.argv[1], sys.argv[2]
print(re.sub(
  r'(?i)(\bFixed in )([0-9a-f]{7,40})(?![0-9a-f])',
  lambda m: f'{m.group(1)}[{m.group(2)}]({repo_url}/commit/{m.group(2)})',
  body
))
EOF
)"

# Reply to the comment thread
gh api \
    -X POST \
    "/repos/${OWNER}/${REPO}/pulls/${PR}/comments/${COMMENT_ID}/replies" \
    -f body="$BODY" \
    -q '"Posted: " + .html_url'
