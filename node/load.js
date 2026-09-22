'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
let cached = null;

// Evaluates src/*.js (except 90_gas.js) in one shared global scope, like Apps Script.
function load() {
  if (cached) return cached;
  const ctx = vm.createContext({ console });
  const files = fs.readdirSync(SRC)
    .filter((f) => f.endsWith('.js') && f !== '90_gas.js')
    .sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
    // Top-level class/const/let bindings are lexical, not global properties; publish them so tests can reach them.
    const names = [...code.matchAll(/^(?:class|const|let)\s+(\w+)/gm)].map((m) => m[1]);
    if (names.length) vm.runInContext(names.map((n) => `globalThis.${n} = ${n};`).join('\n'), ctx);
  }
  cached = ctx;
  return ctx;
}

module.exports = { load };
