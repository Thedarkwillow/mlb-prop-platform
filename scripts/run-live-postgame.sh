#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

# If running after midnight Pacific, grade the previous baseball slate.
HOUR_PT="$(TZ=America/Los_Angeles date +%H)"

if [ "$#" -ge 1 ]; then
  SLATE_DATE="$1"
elif [ "$HOUR_PT" -lt 6 ]; then
  SLATE_DATE="$(TZ=America/Los_Angeles date -d 'yesterday' +%F)"
else
  SLATE_DATE="$(TZ=America/Los_Angeles date +%F)"
fi

mkdir -p logs

echo "LIVE POSTGAME START $(date -Is) slate=$SLATE_DATE"

if [ ! -f data/live/mlb-live-board-history.json ]; then
  echo "No data/live/mlb-live-board-history.json found. Nothing to grade."
  exit 0
fi

ROWS="$(jq --arg d "$SLATE_DATE" '[.[] | select(.date == $d)] | length' data/live/mlb-live-board-history.json 2>/dev/null || echo 0)"

if [ "$ROWS" = "0" ]; then
  echo "No MLB Live tracked rows for $SLATE_DATE. Nothing to grade."
  exit 0
fi

echo "Tracked MLB Live rows for $SLATE_DATE: $ROWS"

npm run live:resolve -- "$SLATE_DATE"
npm run live:grade -- "$SLATE_DATE"
npm run live:alerts -- "$SLATE_DATE"
npm run live:coverage -- "$SLATE_DATE"

echo "LIVE POSTGAME DONE $(date -Is) slate=$SLATE_DATE"
