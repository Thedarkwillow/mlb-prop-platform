#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

echo "============================================================"
echo "VEGAS + PICKS REFRESH START $(date -Is)"
echo "============================================================"

echo "=== 1) REFRESH VEGAS / ODDS API ==="
npm run odds

echo "=== 2) REFRESH PRIZEPICKS BOARD ==="
npm run prizepicks

echo "=== 3) REBUILD PRICED BOARD ==="
npm run board:rebuild

echo "=== 3B) REFRESH PITCH-TYPE / ARSENAL CONTEXT IF AVAILABLE ==="
if npm run | grep -q "savant:velo:full"; then
  npm run savant:velo:full || echo "WARN: savant:velo:full failed; continuing with existing arsenal cache"
elif npm run | grep -q "savant:arsenal:compact"; then
  npm run savant:arsenal:compact || echo "WARN: savant:arsenal:compact failed; continuing with existing arsenal cache"
fi

npm run context:pitch-type || echo "WARN: context:pitch-type failed; continuing with existing board context"
npm run context:coverage || echo "WARN: context:coverage failed; continuing"

npm run price:board

echo "=== 4) BUILD SLIPS / LEANS / WATCHLIST ==="
npm run picks

echo "=== 5) REFRESH CONTEXT / CONTROLLED UNLOCK DIAGNOSTICS ==="
npm run context:coverage
npm run unlocks:readiness

echo "=== 6) REFRESH MOBILE / SHOW REPORTS ==="
npm run mobile
npm run show

echo "=== 7) FILE AGES AFTER RUN ==="
ls -lh --time-style=long-iso \
  data/vegas-consensus.json \
  outputs/priced-board.json \
  outputs/final-slips.json \
  outputs/lean-final-slips.json \
  outputs/watchlist-final-slips.json \
  outputs/blocked-final-candidates.json \
  outputs/playable-final-slips.json 2>/dev/null || true

echo "============================================================"
echo "VEGAS + PICKS REFRESH DONE $(date -Is)"
echo "============================================================"
