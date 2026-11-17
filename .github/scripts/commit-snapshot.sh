#!/usr/bin/env bash
# Commits snapshots/ to main. If main moved meanwhile (a merge, or the other workflow's snapshot),
# rebuilds the snapshot on the latest main and tries again, so neither the Snapshot nor the Demo
# workflow can overwrite what the other just recorded: the rebuild carries today's demo over (#6).
# Usage: commit-snapshot.sh [message suffix]. Needs the env that `pnpm snapshot` needs.
set -euo pipefail
suffix="${1:-}"
git config user.name "dashboard-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
for attempt in 1 2 3; do
  git add snapshots/
  if git diff --cached --quiet; then echo "No change"; exit 0; fi
  git commit -q -m "snapshot: $(date -u +%Y-%m-%dT%H:%MZ)${suffix}"
  if git push -q origin HEAD:main; then echo "Pushed"; exit 0; fi
  echo "main moved; rebuilding the snapshot on the latest main (attempt ${attempt})"
  git fetch -q origin main
  git reset -q --hard origin/main
  pnpm snapshot
done
echo "Could not push the snapshot after 3 attempts" >&2
exit 1
