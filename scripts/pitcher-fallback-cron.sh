#!/usr/bin/env bash
cd /root/mlb-prop-platform || exit 1
npm run proj:pitchers:fallback >> logs/pitcher-fallback-projections.log 2>&1
