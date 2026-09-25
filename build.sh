#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
out=dist/Code.js
# Setup() first so the Apps Script editor lists it on top: run it once to install the menu and authorise.
cat > "$out" <<'PRELUDE'
// Setup: run this once from the Apps Script editor to install the Rotalator menu and authorise the script.
// It is the first function in the editor's list and only calls onOpen; everything else is below.
function Setup() {
  onOpen();
}

PRELUDE
for f in src/*.js; do
  printf '// ---- %s ----\n' "$(basename "$f")" >> "$out"
  cat "$f" >> "$out"
  printf '\n' >> "$out"
done
cp src/appsscript.json dist/
echo "built $out"
