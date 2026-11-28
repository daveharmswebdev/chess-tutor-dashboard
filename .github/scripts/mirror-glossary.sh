#!/usr/bin/env bash
# Mirrors chess-tutor's docs/glossary.json into glossary.json, byte for byte, at one commit (#21).
# chess-tutor owns the client wording (its #83); the dashboard never edits it (P-1). Writes
# glossary.source.json with the commit it copied, which each snapshot records and links (P-4).
# Usage: mirror-glossary.sh <full chess-tutor commit sha>. Prints whether anything changed.
# On any failure the existing copy is left untouched and the script exits non-zero with the reason,
# so a bad fetch never empties the glossary (P-2).
set -euo pipefail
sha="${1:-}"
repo="daveharmswebdev/chess-tutor"
path="docs/glossary.json"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Glossary not mirrored: '$sha' is not a full commit sha." >&2; exit 1
fi
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
# chess-tutor is public, so no token. A pinned sha makes the copy reproducible (the CI check refetches it).
if ! curl -fsS --retry 3 --max-time 30 -o "$tmp" "https://raw.githubusercontent.com/$repo/$sha/$path"; then
  echo "::error::Glossary not mirrored: could not fetch $path at $repo@$sha. The previous copy is kept." >&2; exit 1
fi
if ! jq -e '(.requirements | type == "array" and length > 0)' "$tmp" > /dev/null 2>&1; then
  echo "::error::Glossary not mirrored: $path at $repo@$sha has no requirements list. The previous copy is kept." >&2; exit 1
fi
source_json=$(jq -n --arg repo "$repo" --arg path "$path" --arg commit "$sha" \
  '{ _note: "Written by the mirror step in .github/workflows/snapshot.yml. Do not edit by hand.", repo: $repo, path: $path, commit: $commit }')
if cmp -s "$tmp" glossary.json && [ "$(jq -r .commit glossary.source.json 2>/dev/null || true)" = "$sha" ]; then
  echo "Glossary already mirrors $repo@$sha."; exit 0
fi
cp "$tmp" glossary.json
printf '%s\n' "$source_json" > glossary.source.json
echo "Mirrored $path from $repo@$sha."
