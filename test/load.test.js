'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../node/load.js');

test('loader exposes globals from src/00_util.js', () => {
  const ctx = load();
  assert.equal(typeof ctx.parseDateTime, 'function');
  assert.equal(typeof ctx.fnv1a32, 'function');
  assert.equal(typeof ctx.Grid, 'function');
});

test('loader caches the context per process', () => {
  assert.equal(load(), load());
});
