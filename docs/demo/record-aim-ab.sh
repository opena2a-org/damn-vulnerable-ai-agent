#!/usr/bin/env bash
#
# Record an asciinema cast of `dvaa demo aim-ab` for a live-demo fallback.
#
# Usage:
#   ./docs/demo/record-aim-ab.sh
#
# Output:
#   docs/demo/aim-ab.cast        (asciinema playback file)
#
# Re-run any time the runner output format changes.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAST_FILE="$REPO_ROOT/docs/demo/aim-ab.cast"
LOG_FILE="$(mktemp -t dvaa-record.XXXXXX)"

if ! command -v asciinema >/dev/null 2>&1; then
  echo "asciinema is not installed."
  echo "Install with: brew install asciinema   (macOS)"
  echo "Or:           pip install asciinema    (any platform)"
  exit 1
fi

cd "$REPO_ROOT"

echo "Cleaning prior AIM data directory so the trust score starts at the same value every recording..."
rm -rf .dvaa-aim

echo "Starting DVAA fleet (api agents) in the background..."
DVAA_AIM_DATA_DIR="$(pwd)/.dvaa-aim" node src/index.js --api > "$LOG_FILE" 2>&1 &
DVAA_PID=$!

cleanup() {
  echo "Stopping DVAA fleet (pid $DVAA_PID)..."
  kill "$DVAA_PID" 2>/dev/null || true
  wait "$DVAA_PID" 2>/dev/null || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

echo "Waiting 3s for the fleet to bind ports..."
sleep 3

# Verify both target ports are up before recording. Better to fail fast here
# than ship a recording with "DVAA agents unreachable" as the demo content.
for port in 7005 7014; do
  if ! curl -fsS -m 2 "http://localhost:$port/health" >/dev/null; then
    echo "Port $port is not reachable. Fleet log tail:"
    tail -20 "$LOG_FILE"
    exit 1
  fi
done

echo "Recording asciinema to: $CAST_FILE"
asciinema rec \
  --overwrite \
  --command "node $REPO_ROOT/src/index.js demo aim-ab" \
  --title "DVAA AIM A/B demo: APWN-DE-003 vs RAGBot-AIM" \
  "$CAST_FILE"

echo ""
echo "Recorded: $CAST_FILE"
echo "Play with: asciinema play $CAST_FILE"
