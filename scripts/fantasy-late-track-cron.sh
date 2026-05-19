#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

DATE=$(TZ=America/Los_Angeles date +%F)

echo "===== $(date) | fantasy late track | $DATE ====="

npm run price:board

FANTASY_COUNT=$(jq '[.[] | select(.market=="hitter_fantasy_score")] | length' outputs/priced-board.json)
FANTASY_GAMES=$(jq -r '[.[] | select(.market=="hitter_fantasy_score") | .game] | unique | length' outputs/priced-board.json)

echo "hitter_fantasy_score rows: $FANTASY_COUNT"
echo "hitter_fantasy_score games: $FANTASY_GAMES"

jq -r '
[
  .[] 
  | select(.market=="hitter_fantasy_score")
  | .game
] | unique | .[]
' outputs/priced-board.json

if [ "$FANTASY_COUNT" -ge 100 ] && [ "$FANTASY_GAMES" -ge 6 ]; then
  echo "Fantasy coverage sufficient for tracking snapshot"
  npm run grade:full-board --date="$DATE"
  npm run fantasy:watchlist
else
  echo "Fantasy coverage partial; skipping trust update"
fi
