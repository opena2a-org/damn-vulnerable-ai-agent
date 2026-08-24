#!/usr/bin/env bash
# README must never tell a reader to pull an image tag that does not exist on
# Docker Hub. Extracts every `opena2a/dvaa:<version>` citation from README.md
# and asserts each tag is published. Exit 1 on any unpublished citation.
set -euo pipefail
README="${1:-README.md}"
FAIL=0
TAGS=$(grep -oE 'opena2a/dvaa:[0-9]+\.[0-9]+\.[0-9]+' "$README" | cut -d: -f2 | sort -u)
if [ -z "$TAGS" ]; then
  echo "No opena2a/dvaa:<version> citation found in $README (nothing to check)."
  exit 0
fi
for TAG in $TAGS; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "https://hub.docker.com/v2/repositories/opena2a/dvaa/tags/$TAG")
  if [ "$STATUS" = "200" ]; then
    echo "ok: opena2a/dvaa:$TAG is published"
  else
    echo "FAIL: README cites opena2a/dvaa:$TAG but Docker Hub returns HTTP $STATUS for that tag"
    FAIL=1
  fi
done
exit $FAIL
