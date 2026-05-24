#!/usr/bin/env bash
set -euo pipefail

cd /root/mlb-prop-platform

DATE="$(TZ=America/Los_Angeles date +%F)"

npm run prizepicks:live
npm run live:capture -- "$DATE"
npm run live:track -- "$DATE"
npm run live:resolve -- "$DATE" --quiet
npm run live:grade -- "$DATE"
npm run live:coverage -- "$DATE"
