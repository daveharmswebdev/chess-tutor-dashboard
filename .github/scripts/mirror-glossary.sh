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
# The snapshot build's own rules (validate-glossary.ts): a file that would stop the build is refused here.
here=$(dirname "$0")
if ! reason=$(node --no-warnings --experimental-strip-types "$here/validate-glossary.ts" "$tmp" 2>&1); then
  echo "::error::Glossary not mirrored: $path at $repo@$sha is not usable ($reason). The previous copy is kept." >&2; exit 1
fi
source_json=$(jq -n --arg repo "$repo" --arg path "$path" --arg commit "$sha" \
  '{ _note: "Written by the mirror step in .github/workflows/snapshot.yml. Do not edit by hand.", repo: $repo, path: $path, commit: $commit }')
# Same bytes: keep glossary.source.json too. Its commit still holds this exact file, so the page's link
# stays true, and a merge that doesn't touch the wording adds no commit or redeploy here.
if cmp -s "$tmp" glossary.json && [ -f glossary.source.json ]; then
  echo "Glossary unchanged at $repo@$sha; still mirrors $(jq -r .commit glossary.source.json)."; exit 0
fi
cp "$tmp" glossary.json
printf '%s\n' "$source_json" > glossary.source.json
echo "Mirrored $path from $repo@$sha."
