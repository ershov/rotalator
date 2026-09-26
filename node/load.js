'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const EXT = path.join(SRC, 'ext');
let cached = null;
const loadedExtensions = new Set();

function runFiles(ctx, dir, files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
    // Top-level class/const/let bindings are lexical, not global properties; publish them so tests can reach them.
    const names = [...code.matchAll(/^(?:class|const|let)\s+(\w+)/gm)].map((m) => m[1]);
    if (names.length) vm.runInContext(names.map((n) => `globalThis.${n} = ${n};`).join('\n'), ctx);
  }
}

// Evaluates src/*.js (except 90_gas.js) in one shared global scope, like Apps Script. extensions: names of
// src/ext/<Name>/ directories whose files are added to the same context after the core; the context is one
// per process, so an extension loaded once is present for every later caller.
function load(extensions = []) {
  if (!cached) {
    cached = vm.createContext({ console });
    runFiles(cached, SRC, fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== '90_gas.js').sort());
  }
  for (const name of extensions) {
    if (loadedExtensions.has(name)) continue;
    const dir = path.join(EXT, name);
    if (!fs.existsSync(dir)) throw new Error(`unknown extension "${name}": no ${path.relative(path.join(SRC, '..'), dir)}/`);
    runFiles(cached, dir, fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort());
    loadedExtensions.add(name);
  }
  return cached;
}

module.exports = { load };
