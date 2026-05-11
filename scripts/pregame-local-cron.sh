#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

DATE=$(date +%F)
STAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")

npm run pregame:local --date="$DATE" >> "logs/pregame-local-$DATE.log" 2>&1

DIR="outputs/pregame-final/$DATE/checkpoints/$STAMP"
mkdir -p "$DIR"

for f in \
  outputs/final-slips.json \
  outputs/playable-final-slips.json \
  outputs/official-slip.json \
  outputs/official-slip.txt \
  outputs/bayesian-confidence-$DATE.json \
  outputs/steam-report-$DATE.json \
  outputs/clv-report-$DATE.json \
  outputs/unmatched-pricing.json
do
  [ -f "$f" ] && cp "$f" "$DIR/"
done

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DIR/check-time-utc.txt"
