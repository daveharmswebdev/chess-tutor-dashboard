#!/usr/bin/env bash
# CI check (#21, P-1): glossary.json must be chess-tutor's docs/glossary.json, byte for byte, at the
# commit glossary.source.json names. A hand edit here fails: the wording is changed in chess-tutor.
set -euo pipefail
fail() { echo "::error file=glossary.json::$1" >&2; exit 1; }
[ -f glossary.source.json ] || fail "glossary.source.json is missing, so glossary.json can't be checked against chess-tutor."
repo=$(jq -r '.repo // empty' glossary.source.json)
path=$(jq -r '.path // empty' glossary.source.json)
sha=$(jq -r '.commit // empty' glossary.source.json)
[[ "$repo" == "daveharmswebdev/chess-tutor" && "$path" == "docs/glossary.json" && "$sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "glossary.source.json doesn't name chess-tutor's docs/glossary.json at a full commit sha."
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsS --retry 3 --max-time 30 -o "$tmp" "https://raw.githubusercontent.com/$repo/$sha/$path" \
  || fail "Could not fetch $path at $repo@$sha to compare (network or a commit that doesn't exist)."
cmp -s "$tmp" glossary.json \
  || fail "glossary.json is mirrored from chess-tutor; change it there ($repo, $path). It differs from $repo@${sha:0:7}."
echo "glossary.json matches $repo@${sha:0:7} $path."
