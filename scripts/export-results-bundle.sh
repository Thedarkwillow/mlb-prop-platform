#!/usr/bin/env bash
set -euo pipefail

DATE="${1:-$(TZ=America/Los_Angeles date +%F)}"
OUT_DIR="outputs/downloads/results-$DATE"
ARCHIVE="outputs/downloads/results-$DATE.tar.gz"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

copy_if_exists() {
  local f="$1"
  if [ -f "$f" ]; then
    cp "$f" "$OUT_DIR/"
  fi
}

copy_if_exists "outputs/official-slip.txt"
copy_if_exists "outputs/official-slip.json"
copy_if_exists "outputs/mobile-summary.txt"

copy_if_exists "outputs/mobile-summary-$DATE.txt"


copy_if_exists "outputs/mobile-summary-$DATE.txt"

copy_if_exists "outputs/all-markets-graded.json"
copy_if_exists "outputs/all-markets-unmatched.json"

copy_if_exists "outputs/watchlists/fantasy-less-watchlist.txt"
copy_if_exists "outputs/watchlists/fantasy-less-watchlist.json"

copy_if_exists "outputs/learning/fantasy-learning-report.txt"
copy_if_exists "outputs/learning/fantasy-less-learning-report.txt"

copy_if_exists "data/learning/fantasy-learning.json"
copy_if_exists "data/learning/fantasy-less-learning.json"
copy_if_exists "data/learning/fantasy-policy-audit.json"

copy_if_exists "outputs/history/${DATE}-all-markets-graded.json"
copy_if_exists "outputs/history/${DATE}-all-markets-unmatched.json"
copy_if_exists "outputs/history/${DATE}-fantasy-grades.json"
copy_if_exists "outputs/history/${DATE}-fantasy-grades.txt"
copy_if_exists "outputs/history/${DATE}-official-slip.json"

tar -czf "$ARCHIVE" -C "outputs/downloads" "results-$DATE"

echo "Created $ARCHIVE"
