#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist

# Concatenates the .js files of a directory: a separator line, the file, a newline.
bundle() {
  local out=$1 dir=$2 f
  for f in "$dir"/*.js; do
    printf '// ---- %s ----\n' "$(basename "$f")" >> "$out"
    cat "$f" >> "$out"
    printf '\n' >> "$out"
  done
}

out=dist/Code.js
# Setup() first so the Apps Script editor lists it on top: run it once to install the menu and authorise.
cat > "$out" <<'PRELUDE'
// Setup: run this once from the Apps Script editor to install the Rotalator menu and authorise the script.
// It is the first function in the editor's list and only calls onOpen; everything else is below.
function Setup() {
  onOpen();
}

PRELUDE
bundle "$out" src
cp src/appsscript.json dist/
echo "built $out"

# One bundle per extension: src/ext/<Name>/*.js becomes dist/<Name>.js, no prelude.
for dir in src/ext/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  out=dist/$name.js
  : > "$out"
  bundle "$out" "$dir"
  echo "built $out"
done
