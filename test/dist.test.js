'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Same concatenation as build.sh: a separator line per file, the file, a newline.
function bundle() {
  return fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()
    .map((f) => `// ---- ${f} ----\n` + fs.readFileSync(path.join(SRC, f), 'utf8') + '\n').join('');
}

test('dist/Code.js is the bundle of src/ (run ./build.sh after changing src/)', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'dist', 'Code.js'), 'utf8'), bundle());
});

test('dist/appsscript.json matches src/appsscript.json', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'dist', 'appsscript.json'), 'utf8'), fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
});
