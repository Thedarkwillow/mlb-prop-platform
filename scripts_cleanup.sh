#!/bin/bash
cd /root/mlb-prop-platform || exit 1

mkdir -p logs archive

find logs -type f -name "*.log" -size +20M -exec gzip -f {} \;
find history -type f -name "*.json" -mtime +30 -exec gzip -f {} \;
find logs -type f -name "*.gz" -mtime +60 -delete
find history -type f -name "*.gz" -mtime +90 -delete

echo "cleanup complete: $(date)"

# Clean old immutable run snapshots; these are large generated artifacts.
find outputs/history/runs -mindepth 2 -maxdepth 2 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true
find outputs/history/runs -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null || true
