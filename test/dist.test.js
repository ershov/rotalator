'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Same output as build.sh: the Setup() prelude, then per file a separator line, the file, a newline.
const PRELUDE = [
  '// Setup: run this once from the Apps Script editor to install the Rotalator menu and authorise the script.',
  '// It is the first function in the editor\'s list and only calls onOpen; everything else is below.',
  'function Setup() {',
  '  onOpen();',
  '}',
  '',
  '',
].join('\n');

function bundle() {
  return PRELUDE + fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()
    .map((f) => `// ---- ${f} ----\n` + fs.readFileSync(path.join(SRC, f), 'utf8') + '\n').join('');
}

test('dist/Code.js is the bundle of src/ (run ./build.sh after changing src/)', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'dist', 'Code.js'), 'utf8'), bundle());
});

test('Setup() is the first function of the bundle and calls onOpen', () => {
  const code = fs.readFileSync(path.join(ROOT, 'dist', 'Code.js'), 'utf8');
  assert.equal(/^function (\w+)/m.exec(code)[1], 'Setup');
  assert.match(code, /function Setup\(\) \{\n  onOpen\(\);\n\}/);
});

test('dist/appsscript.json matches src/appsscript.json', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'dist', 'appsscript.json'), 'utf8'), fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
});
