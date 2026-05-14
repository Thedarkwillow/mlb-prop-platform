#!/usr/bin/env bash
set -e

DATE="${1:-$(date -d "yesterday" +%F)}"
REPORT_DIR="/root/mlb-prop-platform/reports"
REPORT_FILE="$REPORT_DIR/report-$DATE.txt"

mkdir -p "$REPORT_DIR"
cd /root/mlb-prop-platform

{
  echo "MLB PROP PLATFORM DAILY REPORT"
  echo "Date: $DATE"
  echo "Generated: $(date)"
  echo
  echo "=============================="
  echo "GRADING + NIGHTLY"
  echo "=============================="
  node src/research/grade-final-slips.cjs "$DATE"
  npm run nightly --date="$DATE"

  echo
  echo "=============================="
  echo "OFFICIAL SLIP"
  echo "=============================="
  cat outputs/official-slip.txt

  echo
  echo
  echo "=============================="
  echo "PHASE 6 DASHBOARD"
  echo "=============================="
  cat outputs/phase6-dashboard.txt
} | tee "$REPORT_FILE"

echo
echo "Saved report:"
echo "$REPORT_FILE"
