'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const W = 7 * 1440;
const D = 1440;
const MON = dt('2026-10-05T09:00');

const R = (pin, start, type, who, arg, end, duration, note) => [pin, start, type, who, arg, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (out, i = 0) => plain(out.rotations[i].rows.map(U.rowToArray));
const shifts = (out, i = 0) => plain(out.rotations[i].rows.filter((r) => r.type === 'shift').map((r) => [U.formatDateTime(r.start), r.who, r.note]));
const ofType = (out, type, i = 0) => out.rotations[i].rows.filter((r) => r.type === type);

function run(cells, now, holidays = []) {
  const ledger = rows(cells);
  const S = U.advance(ledger, dt(now));
  return U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: S }], holidays, links: [] });
}

const SET = R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=5w');
const TEAM = R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol');

test('advance: shift containing now', () => {
  const ledger = rows([SET, TEAM,
    R('', '2026-10-05T09:00', 'shift', 'alice', ''),
    R('', '2026-10-12T09:00', 'shift', 'bob', ''),
  ]);
  assert.equal(U.advance(ledger, dt('2026-10-14T12:00')), dt('2026-10-12T09:00'));
  assert.equal(U.advance(ledger, dt('2026-10-12T09:00')), dt('2026-10-12T09:00'));
  assert.equal(U.advance(ledger, dt('2026-10-11T12:00')), dt('2026-10-05T09:00'));
  const pinned = rows([SET, TEAM, R('x', '2026-10-07T09:00', 'shift', 'alice', '', '', '2w')]);
  assert.equal(U.advance(pinned, dt('2026-10-20T12:00')), dt('2026-10-07T09:00'));
});

test('advance: grid floor when no shift covers now', () => {
  const ledger = rows([SET, TEAM, R('', '2026-10-05T09:00', 'shift', 'alice', '')]);
  assert.equal(U.advance(ledger, dt('2026-11-04T12:00')), dt('2026-11-02T09:00'));
  assert.equal(U.advance(ledger, dt('2026-11-02T08:59')), dt('2026-10-26T09:00'));
  assert.equal(U.advance(rows([SET, TEAM]), dt('2026-10-21T12:00')), dt('2026-10-19T09:00'));
  const gap = rows([SET, TEAM, R('', '2026-10-05T09:00', 'shift', 'alice', ''), R('x', '2026-11-02T09:00', 'shift', 'bob', '')]);
  assert.equal(U.advance(gap, dt('2026-10-14T12:00')), dt('2026-10-12T09:00'));
});

test('advance: raised to anchor', () => {
  const ledger = rows([SET, TEAM]);
  assert.equal(U.advance(ledger, dt('2026-09-30T12:00')), MON);
  const anchored = rows([R('', '2026-09-01T00:00', 'set', '', 'period=1w, anchor=2026-10-05T09:00'), R('', '2026-09-01T00:00', 'team', '', 'alice')]);
  assert.equal(U.advance(anchored, dt('2026-09-15T12:00')), MON);
});

test('advance: raised to the first team or join row', () => {
  const ledger = rows([SET, R('', '2026-10-19T09:00', 'team', '', 'alice, bob')]);
  assert.equal(U.advance(ledger, dt('2026-10-06T12:00')), dt('2026-10-19T09:00'));
  const joined = rows([SET, R('', '2026-10-14T09:00', 'join', 'alice', '')]);
  assert.equal(U.advance(joined, dt('2026-10-06T12:00')), dt('2026-10-14T09:00'));
  assert.equal(U.advance(rows([SET]), dt('2026-10-06T12:00')), MON);
});

test('advance: never before the existing snapshot; null now uses the ledger only', () => {
  const ledger = rows([SET, TEAM, R('', '2026-10-19T09:00', 'snapshot', '', 'alice=7.00, bob=7.00, carol=0.00')]);
  assert.equal(U.advance(ledger, dt('2026-10-06T12:00')), dt('2026-10-19T09:00'));
  assert.equal(U.advance(ledger, dt('2026-10-27T12:00')), dt('2026-10-26T09:00'));
  assert.equal(U.advance(ledger, null), dt('2026-10-19T09:00'));
  assert.equal(U.advance(rows([SET, TEAM]), null), MON);
});

test('bootstrap fills the horizon round robin and is idempotent', () => {
  const out = run([SET, TEAM], '2026-10-05T10:00');
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(cellsOf(out), [
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=5w'),
    R('', '2026-10-05T09:00', 'snapshot', '', ''),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'shift', 'alice', ''),
    R('', '2026-10-12T09:00', 'shift', 'bob', ''),
    R('', '2026-10-19T09:00', 'shift', 'carol', ''),
    R('', '2026-10-26T09:00', 'shift', 'alice', ''),
    R('', '2026-11-02T09:00', 'shift', 'bob', ''),
  ]);
  const again = run(cellsOf(out), '2026-10-05T10:00');
  assert.deepEqual(cellsOf(again), cellsOf(out));
  const later = run(cellsOf(out), '2026-10-11T23:00');
  assert.deepEqual(cellsOf(later), cellsOf(out));
  assert.deepEqual(plain(out.status.rotations[0].roster), [
    { name: 'alice', score: null, projected: 14 },
    { name: 'bob', score: null, projected: 14 },
    { name: 'carol', score: null, projected: 7 },
  ]);
  assert.equal(out.status.rotations[0].snapshotAt, MON);
  assert.equal(out.status.rotations[0].horizonEnd, MON + 5 * W);
});

test('a stale run leaves the gap uncredited and resumes at the grid boundary', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const stale = cellsOf(first).filter((c) => c[2] !== 'shift' || c[1] < '2026-10-19');
  const out = run(stale, '2026-11-04T10:00');
  assert.equal(U.formatDateTime(ofType(out, 'snapshot')[0].start), '2026-11-02T09:00');
  assert.equal(ofType(out, 'snapshot')[0].arg, 'alice=7.00, bob=7.00, carol=0.00');
  assert.deepEqual(shifts(out).map((s) => s[0]).slice(0, 3), ['2026-10-05T09:00', '2026-10-12T09:00', '2026-11-02T09:00']);
});

test('snapshot advances, records scores at S, keeps history and the current shift, prunes the rest', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first);
  cells[4] = R('', '2026-10-12T09:00', 'shift', 'carol', '', '', '', 'edited by hand');
  const out = run(cells, '2026-10-13T10:00');
  assert.deepEqual(cellsOf(out), [
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=5w'),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'shift', 'alice', ''),
    R('', '2026-10-12T09:00', 'snapshot', '', 'alice=7.00, bob=0.00, carol=0.00'),
    R('', '2026-10-12T09:00', 'shift', 'carol', '', '', '', 'edited by hand'),
    R('', '2026-10-19T09:00', 'shift', 'bob', ''),
    R('', '2026-10-26T09:00', 'shift', 'carol', ''),
    R('', '2026-11-02T09:00', 'shift', 'alice', ''),
    R('', '2026-11-09T09:00', 'shift', 'bob', ''),
  ]);
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-13T10:00')), cellsOf(out));
  const third = run(cellsOf(out), '2026-10-20T10:00');
  assert.equal(ofType(third, 'snapshot')[0].arg, 'alice=7.00, bob=0.00, carol=7.00');
  assert.equal(U.formatDateTime(ofType(third, 'snapshot')[0].start), '2026-10-19T09:00');
});

test('snapshot inside a long pinned shift credits the part before S and the rest after', () => {
  const cells = [SET, TEAM, R('x', '2026-10-05T09:00', 'shift', 'alice', '', '', '3w')];
  const first = run(cells, '2026-10-05T10:00');
  assert.deepEqual(shifts(first), [
    ['2026-10-05T09:00', 'alice', ''], ['2026-10-26T09:00', 'bob', ''], ['2026-11-02T09:00', 'carol', ''],
  ]);
  const second = run(cellsOf(first), '2026-10-20T10:00');
  assert.equal(U.formatDateTime(ofType(second, 'snapshot')[0].start), '2026-10-05T09:00');
  assert.deepEqual(cellsOf(second), cellsOf(first));
  const late = run(cellsOf(first), '2026-11-03T10:00');
  assert.equal(ofType(late, 'snapshot')[0].arg, 'alice=21.00, bob=7.00, carol=0.00');
  const stale = rows(cellsOf(first)).filter((r) => r.type !== 'snapshot');
  stale.push(U.makeRow({ type: 'snapshot', start: dt('2026-10-12T09:00'), arg: 'alice=7.00, bob=0.00, carol=0.00' }));
  const resumed = U.regenerate({ rotations: [{ name: 'r', rows: stale, snapshotAt: dt('2026-10-19T09:00') }], holidays: [], links: [] });
  assert.equal(ofType(resumed, 'snapshot')[0].arg, 'alice=14.00, bob=0.00, carol=0.00');
  assert.deepEqual(plain(resumed.status.rotations[0].roster.map((m) => m.projected)), [21, 14, 14]);
});

test('shuffle tiebreak is deterministic across runs and changes with seed', () => {
  const set = (seed) => R('', '2026-10-05T09:00', 'set', '', `period=1w, horizon=8w, tiebreak=shuffle, seed=${seed}`);
  const team = R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol, dave, erin');
  const a = run([set(0), team], '2026-10-05T10:00');
  const b = run([set(0), team], '2026-10-05T10:00');
  assert.deepEqual(cellsOf(a), cellsOf(b));
  assert.deepEqual(cellsOf(run(cellsOf(a), '2026-10-05T10:00')), cellsOf(a));
  const names = shifts(a).map((s) => s[1]);
  assert.equal(names.length, 8);
  assert.deepEqual(new Set(names.slice(0, 5)).size, 5);
  const seeded = run([set(7), team], '2026-10-05T10:00');
  assert.notDeepEqual(shifts(seeded), shifts(a));
  assert.deepEqual(new Set(shifts(seeded).slice(0, 5).map((s) => s[1])).size, 5);
});

test('pinned substitution inside the current shift creates a fill shift', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first);
  cells.push(R('x', '2026-10-14T09:00', 'shift', 'carol', '', '', '1d', 'sub'));
  const out = run(cells, '2026-10-12T10:00');
  assert.deepEqual(shifts(out), [
    ['2026-10-05T09:00', 'alice', ''],
    ['2026-10-12T09:00', 'bob', ''],
    ['2026-10-14T09:00', 'carol', 'sub'],
    ['2026-10-15T09:00', 'carol', ''],
    ['2026-10-19T09:00', 'bob', ''],
    ['2026-10-26T09:00', 'carol', ''],
    ['2026-11-02T09:00', 'alice', ''],
    ['2026-11-09T09:00', 'bob', ''],
  ]);
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-12T10:00')), cellsOf(out));
  const explicitEnd = ofType(out, 'shift').filter((r) => r.end !== null || r.endText !== '');
  assert.equal(explicitEnd.length, 1);
  assert.equal(explicitEnd[0].who, 'carol');
});

test('pin inside the precredit window skips a turn; outside it does not', () => {
  const inside = run([SET, TEAM, R('x', '2026-10-12T09:00', 'shift', 'alice', '')], '2026-10-05T10:00');
  assert.deepEqual(shifts(inside).map((s) => s[1]), ['bob', 'alice', 'carol', 'alice', 'bob']);
  const disabled = run([
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=5w, precredit=0'), TEAM,
    R('x', '2026-10-12T09:00', 'shift', 'alice', ''),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(disabled).map((s) => s[1]), ['alice', 'alice', 'bob', 'carol', 'bob']);
  const farPin = R('x', '2026-11-02T09:00', 'shift', 'alice', '');
  const outside = run([R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=7w'), TEAM, farPin], '2026-10-05T10:00');
  assert.deepEqual(shifts(outside).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'alice', 'bob', 'carol']);
  const widened = run([R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=7w, precredit=5'), TEAM, farPin], '2026-10-05T10:00');
  assert.deepEqual(shifts(widened).map((s) => s[1]), ['bob', 'carol', 'alice', 'bob', 'alice', 'carol', 'alice']);
  assert.deepEqual(cellsOf(run(cellsOf(widened), '2026-10-05T10:00')), cellsOf(widened));
});

test('pin inside the window for someone who joins after S is credited when reached', () => {
  const out = run([SET, TEAM,
    R('', '2026-10-12T09:00', 'join', 'dave', ''),
    R('x', '2026-10-19T09:00', 'shift', 'dave', ''),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'dave', 'carol', 'dave']);
  assert.equal(out.status.rotations[0].roster.find((m) => m.name === 'dave').projected, 14);
});

test('a pinned shift beyond the horizon does not extend the last generated shift', () => {
  const out = run([SET, TEAM, R('x', '2026-12-14T09:00', 'shift', 'bob', '')], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => [s[0], s[1]]), [
    ['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'carol'],
    ['2026-10-26T09:00', 'alice'], ['2026-11-02T09:00', 'bob'], ['2026-12-14T09:00', 'bob'],
  ]);
  assert.deepEqual(plain(out.status.rotations[0].roster.map((m) => m.projected)), [14, 21, 7]);
});

test('exclusion is honoured and closed by include', () => {
  const out = run([SET, TEAM,
    R('', '2026-10-10T00:00', 'exclude', 'bob', ''),
    R('', '2026-10-25T00:00', 'include', 'bob', ''),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'carol', 'alice', 'bob', 'carol']);
  const bounded = run([SET, TEAM, R('', '2026-10-12T09:00', 'exclude', 'bob', '', '2026-10-19T09:00')], '2026-10-05T10:00');
  assert.deepEqual(shifts(bounded).map((s) => s[1]), ['alice', 'carol', 'bob', 'carol', 'alice']);
});

test('exclusion older than the snapshot is clipped and still applies', () => {
  const first = run([SET, TEAM, R('', '2026-10-06T00:00', 'exclude', 'carol', '', '2026-10-30T00:00')], '2026-10-05T10:00');
  assert.deepEqual(shifts(first).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'carol']);
  const out = run(cellsOf(first), '2026-10-13T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'carol', 'carol']);
  const gone = run(cellsOf(first).concat([R('', '2026-10-11T00:00', 'leave', 'carol', '')]), '2026-10-13T10:00');
  assert.deepEqual(plain(gone.errors), []);
  assert.deepEqual(shifts(gone).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'alice', 'bob']);
});

test('min_distance keeps rest between shifts and is relaxed with a note', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=4w, min_distance=2'),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out), [
    ['2026-10-05T09:00', 'alice', ''],
    ['2026-10-12T09:00', 'bob', ''],
    ['2026-10-19T09:00', 'alice', 'min_distance relaxed to 1'],
    ['2026-10-26T09:00', 'bob', 'min_distance relaxed to 1'],
  ]);
  assert.deepEqual(plain(out.status.warnings.map((w) => w.message)), ['min_distance relaxed to 1', 'min_distance relaxed to 1']);
  assert.deepEqual(plain(out.errors), []);
  const three = run([
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=6w, min_distance=1'),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol'),
    R('', '2026-10-19T09:00', 'exclude', 'carol', '', '', '1w'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(three), [
    ['2026-10-05T09:00', 'alice', ''],
    ['2026-10-12T09:00', 'bob', ''],
    ['2026-10-19T09:00', 'alice', ''],
    ['2026-10-26T09:00', 'carol', ''],
    ['2026-11-02T09:00', 'bob', ''],
    ['2026-11-09T09:00', 'carol', ''],
  ]);
});

test('tolerance widens the candidate band and order tiebreak walks the roster', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=4w, tolerance=7'),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice']);
});

test('team diff with baselines: leavers, joiners, adjustments and order', () => {
  const first = run([R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=6w'), TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first);
  cells.push(R('', '2026-10-19T09:00', 'team', '', 'carol, dave=max, alice, erin, bob+=10'));
  const out = run(cells, '2026-10-12T10:00');
  assert.deepEqual(shifts(out), [
    ['2026-10-05T09:00', 'alice', ''],
    ['2026-10-12T09:00', 'bob', ''],
    ['2026-10-19T09:00', 'carol', ''],
    ['2026-10-26T09:00', 'dave', ''],
    ['2026-11-02T09:00', 'alice', ''],
    ['2026-11-09T09:00', 'erin', ''],
    ['2026-11-16T09:00', 'carol', ''],
  ]);
  assert.deepEqual(plain(out.status.rotations[0].roster), [
    { name: 'carol', score: 0, projected: 14 },
    { name: 'dave', score: null, projected: 14 },
    { name: 'alice', score: 7, projected: 14 },
    { name: 'erin', score: null, projected: 14 },
    { name: 'bob', score: 0, projected: 17 },
  ]);
  const shrunk = run(cellsOf(first).concat([R('', '2026-10-19T09:00', 'team', '', 'bob, alice')]), '2026-10-12T10:00');
  assert.deepEqual(shifts(shrunk).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'alice', 'bob', 'alice']);
});

test('join with each baseline and leave', () => {
  const first = run([R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=6w'), TEAM], '2026-10-05T10:00');
  const scoresAfter = (extra, now) => {
    const out = run(cellsOf(first).concat(extra), now);
    assert.deepEqual(plain(out.errors), []);
    return plain(out.status.rotations[0].roster);
  };
  const at = '2026-10-19T09:00';
  const snap = R('', '2026-10-19T09:00', 'snapshot', '', 'alice=7.00, bob=7.00, carol=0.00');
  const base = cellsOf(first).filter((c) => c[2] !== 'snapshot').concat([snap]);
  const joined = (arg) => {
    const ledger = rows(base.concat([R('', at, 'join', 'dave', arg)]));
    const out = U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: dt('2026-10-26T09:00') }], holidays: [], links: [] });
    assert.deepEqual(plain(out.errors), []);
    assert.equal(ofType(out, 'snapshot')[0].arg.split(', ')[2], 'carol=7.00');
    return out.status.rotations[0].roster.find((m) => m.name === 'dave').score;
  };
  assert.equal(joined(''), 7);
  assert.equal(joined('median'), 7);
  assert.equal(joined('mean'), 14 / 3);
  assert.equal(joined('min'), 0);
  assert.equal(joined('max'), 7);
  assert.equal(joined('2.5'), 2.5);
  const left = scoresAfter([R('', '2026-10-19T09:00', 'leave', 'carol', '')], '2026-10-12T10:00');
  assert.deepEqual(left.map((m) => m.name), ['alice', 'bob']);
});

test('period change via set realigns the grid and cuts the running claim', () => {
  const out = run([SET, TEAM, R('', '2026-10-21T09:00', 'set', '', 'period=2d')], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[0]), [
    '2026-10-05T09:00', '2026-10-12T09:00', '2026-10-19T09:00', '2026-10-21T09:00', '2026-10-23T09:00', '2026-10-25T09:00',
    '2026-10-27T09:00', '2026-10-29T09:00', '2026-10-31T09:00', '2026-11-02T09:00', '2026-11-04T09:00', '2026-11-06T09:00', '2026-11-08T09:00',
  ]);
  assert.equal(shifts(out)[2][1], 'carol');
  assert.equal(shifts(out)[3][1], 'carol');
  assert.equal(out.status.rotations[0].horizonEnd, dt('2026-11-10T09:00'));
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-05T10:00')), cellsOf(out));
  const later = run(cellsOf(out), '2026-10-22T10:00');
  assert.equal(U.formatDateTime(ofType(later, 'snapshot')[0].start), '2026-10-21T09:00');
  assert.equal(ofType(later, 'snapshot')[0].arg, 'alice=7.00, bob=7.00, carol=2.00');
});

test('unassignable slot emits a nobody shift and an error row', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=3w'),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob'),
    R('', '2026-10-12T09:00', 'exclude', 'alice', '', '', '1w'),
    R('', '2026-10-12T09:00', 'exclude', 'bob', '', '', '1w'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out), [['2026-10-05T09:00', 'alice', ''], ['2026-10-12T09:00', '', ''], ['2026-10-19T09:00', 'bob', '']]);
  const errors = ofType(out, 'error');
  assert.equal(errors.length, 1);
  assert.equal(U.formatDateTime(errors[0].start), '2026-10-12T09:00');
  assert.match(errors[0].arg, /no eligible member/);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].rotation, 'r');
  const cells = cellsOf(out);
  assert.ok(cells.findIndex((c) => c[2] === 'error') < cells.findIndex((c) => c[2] === 'shift' && c[3] === ''));
  assert.deepEqual(cellsOf(run(cells, '2026-10-05T10:00')), cells);
});

test('validation errors return rows unchanged plus error rows and skip regeneration', () => {
  const cells = [SET, TEAM,
    R('', '2026-10-06T09:00', 'error', '', 'stale'),
    R('', '2026-10-12T09:00', 'shift', 'alice, bob', ''),
    R('', 'nope', 'leave', 'alice', ''),
  ];
  const out = run(cells, '2026-10-05T10:00');
  assert.equal(out.errors.length, 2);
  assert.deepEqual(cellsOf(out), [
    SET, TEAM,
    R('', '2026-10-12T09:00', 'error', '', 'who must be exactly one member id'),
    R('', '2026-10-12T09:00', 'shift', 'alice, bob', ''),
    R('', 'nope', 'error', '', 'bad start "nope"'),
    R('', 'nope', 'leave', 'alice', ''),
  ]);
  assert.deepEqual(plain(out.status), { rotations: [], warnings: [] });
});

test('stateful errors: join of a member, leave of a stranger, no regeneration in any rotation', () => {
  const bad = [SET, TEAM, R('', '2026-10-12T09:00', 'join', 'alice', '')];
  const good = [SET, R('', '2026-10-05T09:00', 'team', '', 'dave')];
  const out = U.regenerate({
    rotations: [{ name: 'a', rows: rows(bad), snapshotAt: MON }, { name: 'b', rows: rows(good), snapshotAt: MON }],
    holidays: [], links: [],
  });
  assert.deepEqual(plain(out.errors.map((e) => [e.rotation, e.message])), [['a', 'join: "alice" is already a member']]);
  assert.deepEqual(cellsOf(out, 0), [SET, TEAM, R('', '2026-10-12T09:00', 'error', '', 'join: "alice" is already a member'), bad[2]]);
  assert.deepEqual(cellsOf(out, 1), good);
  const stranger = run([SET, TEAM, R('', '2026-10-12T09:00', 'leave', 'zed', '')], '2026-10-05T10:00');
  assert.deepEqual(plain(stranger.errors.map((e) => e.message)), ['leave: unknown member "zed"']);
  assert.equal(ofType(stranger, 'shift').length, 0);
});

test('score rows and skip settings affect credit', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=3w, skip_weekends=true, skip_holidays=true'),
    R('', '2026-10-05T09:00', 'team', '', 'alice, bob'),
    R('', '2026-10-05T09:00', 'score', '', 'alice+=100'),
  ], '2026-10-05T10:00', [U.parseDay('2026-10-14')]);
  assert.deepEqual(shifts(out).map((s) => s[1]), ['bob', 'bob', 'bob']);
  assert.deepEqual(plain(out.status.rotations[0].roster), [
    { name: 'alice', score: null, projected: 100 },
    { name: 'bob', score: null, projected: 14 },
  ]);
});

test('multiple rotations are swept together, each with its own state', () => {
  const out = U.regenerate({
    rotations: [
      { name: 'primary', rows: rows([SET, TEAM]), snapshotAt: MON },
      { name: 'secondary', rows: rows([R('', '2026-10-05T09:00', 'set', '', 'period=2w, horizon=5w'), R('', '2026-10-05T09:00', 'team', '', 'dave, erin')]), snapshotAt: MON },
    ],
    holidays: [], links: [],
  });
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shifts(out, 0).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'bob']);
  assert.deepEqual(shifts(out, 1).map((s) => [s[0], s[1]]), [['2026-10-05T09:00', 'dave'], ['2026-10-19T09:00', 'erin'], ['2026-11-02T09:00', 'dave']]);
  assert.deepEqual(plain(out.status.rotations.map((r) => r.name)), ['primary', 'secondary']);
});

test('regenerate without snapshotAt falls back to the ledger and never moves the snapshot back', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first).map((c) => (c[2] === 'snapshot' ? R('', '2026-10-12T09:00', 'snapshot', '', 'alice=7.00, bob=0.00, carol=0.00') : c));
  const out = U.regenerate({ rotations: [{ name: 'r', rows: rows(cells) }], holidays: [], links: [] });
  assert.equal(U.formatDateTime(ofType(out, 'snapshot')[0].start), '2026-10-12T09:00');
  const back = U.regenerate({ rotations: [{ name: 'r', rows: rows(cells), snapshotAt: MON }], holidays: [], links: [] });
  assert.equal(U.formatDateTime(ofType(back, 'snapshot')[0].start), '2026-10-12T09:00');
});
