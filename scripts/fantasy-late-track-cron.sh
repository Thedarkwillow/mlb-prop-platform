#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

DATE=$(TZ=America/Los_Angeles date +%F)

echo "===== $(date) | late track-only market check | $DATE ====="

npm run price:board
npm run fantasy:project
npm run fantasy:watchlist

for MARKET in hitter_fantasy_score pitcher_fantasy_score pitches_thrown plate_appearances batter_strikeouts triples; do
  COUNT=$(jq --arg m "$MARKET" '[.[] | select(.market==$m)] | length' outputs/priced-board.json)
  GAMES=$(jq --arg m "$MARKET" '[.[] | select(.market==$m) | .game] | unique | length' outputs/priced-board.json)
  echo "$MARKET rows: $COUNT"
  echo "$MARKET games: $GAMES"
done

FANTASY_COUNT=$(jq '[.[] | select(.market=="hitter_fantasy_score" or .market=="pitcher_fantasy_score")] | length' outputs/priced-board.json)
FANTASY_GAMES=$(jq '[.[] | select(.market=="hitter_fantasy_score" or .market=="pitcher_fantasy_score") | .game] | unique | length' outputs/priced-board.json)

if [ "$FANTASY_COUNT" -ge 100 ] && [ "$FANTASY_GAMES" -ge 6 ]; then
  echo "Fantasy coverage sufficient for tracking snapshot"
  npm run grade:full-board --date="$DATE"
else
  echo "Fantasy coverage partial; skipping trust update"
fi
