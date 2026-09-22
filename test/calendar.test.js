'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const W = 7 * 1440;
const MON = dt('2026-10-05T09:00');

test('Grid floor, ceil, next with anchor before and after t', () => {
  const g = new U.Grid({ period: W, anchor: MON });
  const wed = dt('2026-10-07T12:00');
  assert.equal(g.floor(wed), MON);
  assert.equal(g.ceil(wed), MON + W);
  assert.equal(g.next(wed), MON + W);
  assert.equal(g.floor(MON), MON);
  assert.equal(g.ceil(MON), MON);
  assert.equal(g.next(MON), MON + W);
  assert.equal(g.next(MON - 1), MON);
  const early = dt('2026-09-01T00:00');
  assert.equal(U.formatDateTime(g.floor(early)), '2026-08-31T09:00');
  assert.equal(U.formatDateTime(g.ceil(early)), '2026-09-07T09:00');
  const daily = new U.Grid({ period: 1440, anchor: 0 });
  assert.equal(daily.floor(-1), -1440);
  assert.equal(daily.next(-1), 0);
});

test('units counts fractional days and skips weekends and holidays', () => {
  assert.equal(U.units(MON, MON + W), 7);
  assert.equal(U.units(MON, MON + W, { skip_weekends: true }), 5);
  assert.equal(U.units(MON, MON + 1440), 1);
  assert.equal(U.units(MON, MON + 360), 0.25);
  assert.equal(U.units(MON, MON), 0);
  assert.equal(U.units(MON, MON - 1), 0);
  const friEve = dt('2026-10-09T18:00');
  assert.equal(U.units(friEve, friEve + 720), 0.5);
  assert.equal(U.units(friEve, friEve + 720, { skip_weekends: true }), 0.25);
  const holidays = new Set([U.parseDay('2026-10-07')]);
  assert.equal(U.units(MON, MON + W, { skip_holidays: true, holidays }), 6);
  assert.equal(U.units(MON, MON + W, { skip_holidays: false, holidays }), 7);
  assert.equal(U.units(MON, MON + W, { skip_weekends: true, skip_holidays: true, holidays }), 4);
  const midnight = dt('2026-10-06T00:00');
  assert.equal(U.units(midnight - 90, midnight + 30, { skip_holidays: true, holidays: new Set([U.parseDay('2026-10-06')]) }), 90 / 1440);
});

test('claimEnd: explicit end or next boundary, truncated by next shift and grid change', () => {
  const g = new U.Grid({ period: W, anchor: MON });
  const open = U.makeRow({ type: 'shift', start: MON + 1440, who: 'a' });
  assert.equal(U.claimEnd(open, null, g, []), MON + W);
  assert.equal(U.claimEnd(open, MON + 3 * 1440, g, []), MON + 3 * 1440);
  assert.equal(U.claimEnd(open, MON + 2 * W, g, []), MON + W);
  assert.equal(U.claimEnd(open, null, g, [MON, MON + 2 * 1440, MON + 5 * 1440]), MON + 2 * 1440);
  assert.equal(U.claimEnd(open, MON + 2 * 1440, g, [MON + 3 * 1440]), MON + 2 * 1440);
  const long = U.makeRow({ type: 'shift', start: MON, who: 'a', duration: 2 * W });
  assert.equal(U.claimEnd(long, null, g, []), MON + 2 * W);
  assert.equal(U.claimEnd(long, MON + W, g, []), MON + W);
  assert.equal(U.claimEnd(long, undefined, g, undefined), MON + 2 * W);
});

test('scoredEnd: explicit end, else the earlier of next shift start and next boundary', () => {
  const g = new U.Grid({ period: W, anchor: MON });
  const open = U.makeRow({ type: 'shift', start: MON + 1440, who: 'a' });
  assert.equal(U.scoredEnd(open, null, g), MON + W);
  assert.equal(U.scoredEnd(open, MON + 3 * 1440, g), MON + 3 * 1440);
  assert.equal(U.scoredEnd(open, MON + 3 * W, g), MON + W);
  const fixed = U.makeRow({ type: 'shift', start: MON, end: MON + 720 });
  assert.equal(U.scoredEnd(fixed, MON + 60, g), MON + 720);
});
