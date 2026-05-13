#!/usr/bin/env bash
set -e

DATE="${1:-$(date -d "yesterday" +%F)}"
REPORT_DIR="/root/mlb-prop-platform/reports"
REPORT_FILE="$REPORT_DIR/all-props-report-$DATE.txt"

mkdir -p "$REPORT_DIR"
cd /root/mlb-prop-platform

{
  echo "MLB ALL PROPS REPORT"
  echo "Date: $DATE"
  echo "Generated: $(date)"
  echo

  echo "=============================="
  echo "ALL MARKET GRADING"
  echo "=============================="
  node src/reports/grade-all-markets.js "$DATE"

  echo
  echo "=============================="
  echo "MARKET LEARNING UPDATE"
  echo "=============================="
  node src/learning/build-market-learning.js

  echo
  echo "=============================="
  echo "ALL MARKET FILES"
  echo "=============================="
  ls -lah outputs | grep -E "all-markets|graded|summary"

  echo
  echo "=============================="
  echo "ALL MARKETS SUMMARY"
  echo "=============================="
  cat outputs/all-markets-summary.txt
} | tee "$REPORT_FILE"

echo
echo "Saved report:"
echo "$REPORT_FILE"
