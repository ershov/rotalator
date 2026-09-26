'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const EXT = path.join(SRC, 'ext');
const DIST = path.join(ROOT, 'dist');

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

function concat(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    .map((f) => `// ---- ${f} ----\n` + fs.readFileSync(path.join(dir, f), 'utf8') + '\n').join('');
}

function extensions() {
  return fs.existsSync(EXT) ? fs.readdirSync(EXT).filter((n) => fs.statSync(path.join(EXT, n)).isDirectory()).sort() : [];
}

test('dist/Code.js is the bundle of src/ (run ./build.sh after changing src/)', () => {
  assert.equal(fs.readFileSync(path.join(DIST, 'Code.js'), 'utf8'), PRELUDE + concat(SRC));
});

test('Setup() is the first function of the bundle and calls onOpen', () => {
  const code = fs.readFileSync(path.join(DIST, 'Code.js'), 'utf8');
  assert.equal(/^function (\w+)/m.exec(code)[1], 'Setup');
  assert.match(code, /function Setup\(\) \{\n  onOpen\(\);\n\}/);
});

test('dist/appsscript.json matches src/appsscript.json', () => {
  assert.equal(fs.readFileSync(path.join(DIST, 'appsscript.json'), 'utf8'), fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
});

// Every src/ext/<Name>/ has its dist/<Name>.js without the prelude, and dist/ holds no other bundle.
test('dist/<Name>.js is the bundle of each src/ext/<Name>/ and nothing else is bundled', () => {
  const names = extensions();
  for (const name of names) {
    assert.equal(fs.readFileSync(path.join(DIST, `${name}.js`), 'utf8'), concat(path.join(EXT, name)), name);
  }
  const bundles = fs.readdirSync(DIST).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(bundles, ['Code.js', ...names.map((n) => `${n}.js`)].sort(), 'stale bundle in dist/; remove it');
});
