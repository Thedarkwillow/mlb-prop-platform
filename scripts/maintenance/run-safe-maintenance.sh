#!/usr/bin/env bash
set -euo pipefail
cd /root/mlb-prop-platform
mkdir -p logs

npm run cleanup:compress:safe >> logs/maintenance-cron.log 2>&1
npm run audit:pf-disagree-hitters >> logs/maintenance-cron.log 2>&1
npm run repair:pitcher-projections:upstream >> logs/maintenance-cron.log 2>&1
