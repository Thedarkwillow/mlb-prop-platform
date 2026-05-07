#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

DATE="${1:-$(date -u -d yesterday +%F)}"

node src/research/grade-final-slips.cjs "$DATE"
node src/research/dedupe-graded-history.cjs
node src/research/report-graded-history.cjs
