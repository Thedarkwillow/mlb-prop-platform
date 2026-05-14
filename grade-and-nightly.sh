#!/usr/bin/env bash
set -e

DATE="${1:-$(date -d "yesterday" +%F)}"

cd /root/mlb-prop-platform

echo "Running for date: $DATE"

echo "== Grading =="
node src/research/grade-final-slips.cjs "$DATE"

echo
echo "== Checking output =="
ls outputs | grep "playable-final-slips-graded-$DATE"

echo
echo "== Nightly =="
npm run nightly --date="$DATE"

echo
echo "== Official Slip =="
cat outputs/official-slip.txt

echo
echo "== Phase 6 Dashboard =="
cat outputs/phase6-dashboard.txt
