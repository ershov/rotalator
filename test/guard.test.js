'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

test('runGuard: elapsed, abort first, then the budget, with an injected clock', () => {
  let now = 1000, flag = false;
  const guard = U.runGuard({ start: 1000, budgetSeconds: 300, clock: () => now, aborted: () => flag });
  assert.equal(guard.elapsedSeconds(), 0);
  assert.equal(guard.stopReason(), null);
  now = 1000 + 299 * 1000 + 499;
  assert.equal(guard.elapsedSeconds(), 299);
  assert.equal(guard.stopReason(), null);
  now = 1000 + 300 * 1000;
  assert.equal(guard.stopReason(), 'budget');
  flag = true;
  assert.equal(guard.stopReason(), 'aborted', 'abort wins over the budget');
  now = 1000; flag = true;
  assert.equal(guard.stopReason(), 'aborted');
  // No budget and no abort flag: never stops.
  const open = U.runGuard({ start: 0, clock: () => 1e9 });
  assert.equal(open.stopReason(), null);
  assert.equal(open.elapsedSeconds(), 1000000);
});

test('stopNote and currentRunGuard', () => {
  assert.equal(U.stopNote('aborted', 12, 'event(s)'), 'aborted after 12 event(s)');
  assert.equal(U.stopNote('budget', 0, 'deletion(s)'), 'time budget reached after 0 deletion(s); the next run continues');
  const idle = U.currentRunGuard();
  assert.equal(idle.stopReason(), null);
  assert.equal(idle.elapsedSeconds(), 0);
  // The adapter arms the active guard; helpers pick it up until it is cleared.
  U.activeRunGuard = U.runGuard({ start: 0, budgetSeconds: 1, clock: () => 5000 });
  try {
    assert.equal(U.currentRunGuard().stopReason(), 'budget');
    assert.equal(U.currentRunGuard().elapsedSeconds(), 5);
  } finally { U.activeRunGuard = null; }
  assert.equal(U.currentRunGuard().stopReason(), null);
});

test('throttledFlag: reads at most once per interval, caches in between', () => {
  let reads = 0, flag = false, now = 0;
  const check = U.throttledFlag(() => { reads++; return flag; }, 3000, () => now);
  assert.equal(check(), false);
  flag = true;
  assert.equal(check(), false, 'cached');
  now = 2999;
  assert.equal(check(), false);
  assert.equal(reads, 1);
  now = 3000;
  assert.equal(check(), true);
  assert.equal(reads, 2);
  now = 4000;
  assert.equal(check(), true);
  assert.equal(reads, 2);
});

test('throttledProgress: first call reports, calls within the interval do not, the next after it does', () => {
  const reports = [];
  let now = 0;
  const step = U.throttledProgress((a, b) => reports.push([a, b]), 10000, () => now);
  assert.equal(step('a', 1), true);
  now = 9999;
  assert.equal(step('b', 2), false);
  now = 10000;
  assert.equal(step('c', 3), true);
  now = 15000;
  assert.equal(step('d', 4), false);
  now = 20000;
  assert.equal(step('e', 5), true);
  assert.deepEqual(reports, [['a', 1], ['c', 3], ['e', 5]]);
});
