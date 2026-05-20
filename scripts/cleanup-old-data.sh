#!/bin/bash
set -e

cd /root/mlb-prop-platform/data/odds-history
ls -1 | sort | head -n -2 | xargs -r rm -rf

cd /root/mlb-prop-platform/outputs/history/runs
ls -1 | sort | head -n -20 | xargs -r rm -rf

df -h
