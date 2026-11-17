#!/usr/bin/env bash
# `pnpm demo`: starts the Demo workflow (same as its Run workflow button) and watches that run to
# the end, using your local gh login. Waits for the new run to appear rather than guessing (#6).
set -euo pipefail
latest() { gh run list --workflow demo.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId // ""'; }
before="$(latest)"
gh workflow run demo.yml
for _ in $(seq 1 30); do
  id="$(latest)"
  if [ -n "$id" ] && [ "$id" != "$before" ]; then
    exec gh run watch "$id" --exit-status
  fi
  sleep 2
done
echo "The Demo run did not appear within 60 s; check the Actions tab." >&2
exit 1
