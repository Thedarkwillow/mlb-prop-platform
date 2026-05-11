#!/usr/bin/env bash
set -e
cd /root/mlb-prop-platform
DATE=$(TZ=America/Los_Angeles date +%F)
npm run context:confirmed-lineups --date="$DATE"
npm run context:depth
node src/jobs/slipBuilder.js
