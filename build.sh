#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
out=dist/Code.js
: > "$out"
for f in src/*.js; do
  printf '// ---- %s ----\n' "$(basename "$f")" >> "$out"
  cat "$f" >> "$out"
  printf '\n' >> "$out"
done
cp src/appsscript.json dist/
echo "built $out"
