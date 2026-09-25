'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();
const { runStorage } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const fmt = (min) => U.formatDateTime(min);
const MON = dt('2026-10-05T09:00');

const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (out, i = 0) => plain(out.rotations[i].rows.map(U.rowToArray));
const shifts = (out, i = 0) => plain(out.rotations[i].rows.filter((r) => r.type === 'shift').map((r) => [fmt(r.start), r.what, r.pin]));
const ofType = (out, type, i = 0) => out.rotations[i].rows.filter((r) => r.type === type);

const BASE = 'period=1w, horizon=4w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false';
const SET = (extra = 'autopin=a:0') => R('', '2026-10-05T09:00', 'set', BASE + (extra ? ', ' + extra : ''));
const TEAM = R('', '2026-10-05T09:00', 'team', 'alice, bob, carol');
const SNAP = R('', '2026-10-12T09:00', 'snapshot', 'alice=7, bob=0, carol=0');
const WEEK1 = R('a', '2026-10-05T09:00', 'shift', 'alice');

// Runs through the runner so autopin applies; ledgers keyed by rotation name.
function run(ledgers, now, global = []) {
  const storage = new MemoryStorage({ ledgers: typeof ledgers === 'object' && !Array.isArray(ledgers) ? ledgers : { r: ledgers }, global });
  const result = runStorage(storage, now, { write: true });
  return { result, ledgers: storage.ledgers };
}
const shiftsIn = (cells) => cells.filter((c) => c[2] === 'shift').map((c) => [c[1], c[3], c[0]]);

test('a stored snapshot with a gap after it: the gap is backfilled with assigned shifts', () => {
  const ledger = [SET(), TEAM, WEEK1, SNAP, R('a', '2026-10-12T09:00', 'shift', 'bob')];
  const { ledgers } = run(ledger, '2026-11-11T10:00');
  const got = shiftsIn(ledgers.r);
  assert.deepEqual(got.map((s) => [s[0], s[1]]).slice(0, 6), [
    ['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'carol'], ['2026-10-26T09:00', 'alice'],
    ['2026-11-02T09:00', 'bob'], ['2026-11-09T09:00', 'carol'],
  ]);
  const snapshot = ledgers.r.find((c) => c[2] === 'snapshot');
  assert.deepEqual([snapshot[1], snapshot[3]], ['2026-11-09T09:00', 'alice=14, bob=14, carol=7']);
  // Backfilled shifts up to now are pinned by autopin=a:0; the future floats.
  assert.deepEqual(got.map((s) => s[2]), ['a', 'a', 'a', 'a', 'a', 'a', '', '', '']);
});

test('an unpinned past shift is regenerated with autopin=false and kept when pinned by autopin', () => {
  // The stored snapshot is 10-05 here, so the 10-12 shift lies after it. With autopin=false nothing gets
  // pinned and a hand edit to it is overwritten next run.
  const snap0 = R('', '2026-10-05T09:00', 'snapshot', 'alice=0, bob=0, carol=0');
  const floating = [SET('autopin=false'), TEAM, WEEK1, snap0, R('', '2026-10-12T09:00', 'shift', 'carol', '', '', 'hand edit')];
  const regenerated = run(floating, '2026-10-20T10:00');
  assert.deepEqual(shiftsIn(regenerated.ledgers.r).slice(0, 3), [['2026-10-05T09:00', 'alice', 'a'], ['2026-10-12T09:00', 'bob', ''], ['2026-10-19T09:00', 'carol', '']]);
  assert.equal(regenerated.ledgers.r.some((c) => c[6] === 'hand edit'), false);
  // The shift at the stored snapshot itself is kept even unpinned, like everything at or before it.
  const atP = run([SET('autopin=false'), TEAM, WEEK1, SNAP, R('', '2026-10-12T09:00', 'shift', 'carol', '', '', 'at P')], '2026-10-20T10:00');
  assert.deepEqual(shiftsIn(atP.ledgers.r).slice(1, 3), [['2026-10-12T09:00', 'carol', ''], ['2026-10-19T09:00', 'bob', '']]);
  // With autopin=a:0 the previous run pinned 10-12; a later hand edit keeps the pin and survives.
  const first = run([SET(), TEAM, WEEK1, snap0], '2026-10-13T10:00').ledgers.r;
  const edited = first.map((c) => (c[1] === '2026-10-12T09:00' && c[2] === 'shift' ? R('a', c[1], 'shift', 'carol', '', '', 'hand edit') : c));
  const kept = run(edited, '2026-10-20T10:00');
  assert.deepEqual(shiftsIn(kept.ledgers.r).slice(0, 3), [['2026-10-05T09:00', 'alice', 'a'], ['2026-10-12T09:00', 'carol', 'a'], ['2026-10-19T09:00', 'bob', 'a']]);
  assert.equal(kept.ledgers.r.find((c) => c[6] === 'hand edit')[3], 'carol');
  // Rows before the stored snapshot never move even when unpinned.
  const before = [SET('autopin=false'), TEAM, R('', '2026-10-05T09:00', 'shift', 'carol', '', '', 'history'), SNAP];
  const untouched = run(before, '2026-10-20T10:00');
  assert.deepEqual(shiftsIn(untouched.ledgers.r)[0], ['2026-10-05T09:00', 'carol', '']);
});

test('a pinned shift with an empty assignee is a wanted gap: kept, no slot, no error row', () => {
  const gap = R('x', '2026-10-19T09:00', 'shift', '', '', '', 'planned downtime');
  const { result, ledgers } = run([SET(), TEAM, WEEK1, SNAP, gap], '2026-10-13T10:00');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(shiftsIn(ledgers.r).slice(0, 4).map((s) => [s[0], s[1]]), [
    ['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', ''], ['2026-10-26T09:00', 'carol'],
  ]);
  assert.equal(ledgers.r.filter((c) => c[2] === 'error').length, 0);
  assert.equal(ledgers.r.find((c) => c[6] === 'planned downtime')[0], 'x');
});

test('idempotence and full-replay equality with a backfilled span', () => {
  const ledger = [SET(), TEAM, WEEK1, SNAP];
  const first = run(ledger, '2026-11-04T10:00').ledgers.r;
  const again = run(first, '2026-11-04T10:00').ledgers.r;
  assert.deepEqual(again, first);
  const replayed = run(first.filter((c) => c[2] !== 'snapshot'), '2026-11-04T10:00').ledgers.r;
  assert.deepEqual(replayed, first);
  // Without pins and without a snapshot the whole timeline is the script's and comes out the same.
  const bare = run(first.filter((c) => c[2] !== 'snapshot').map((c) => (c[2] === 'shift' ? R('', c[1], 'shift', c[3]) : c)), '2026-11-04T10:00').ledgers.r;
  assert.deepEqual(bare, first);
});

test('the current shift is regenerated at its boundary when unpinned, so nothing visible changes', () => {
  const ledger = [SET('autopin=false'), TEAM, WEEK1, SNAP];
  const a = run(ledger, '2026-10-13T10:00');
  const b = run(a.ledgers.r, '2026-10-14T10:00');
  assert.deepEqual(b.ledgers.r, a.ledgers.r);
  assert.equal(a.result.status.rotations[0].current.who, 'bob');
  const unassignable = run([SET(), R('', '2026-10-05T09:00', 'team', 'alice'), WEEK1, R('', '2026-10-12T09:00', 'snapshot', 'alice=7'), R('', '2026-10-12T09:00', 'leave', 'alice')], '2026-10-13T10:00');
  const twice = run(unassignable.ledgers.r, '2026-10-13T10:00');
  assert.deepEqual(twice.ledgers.r, unassignable.ledgers.r);
  assert.equal(unassignable.ledgers.r.filter((c) => c[2] === 'error').length, 4);
});

test('first run keeps hand-typed history, fills its gaps and pins it; the second run is identical', () => {
  const set = R('', '2026-08-03T09:00', 'set', BASE + ', autopin=a:0');
  const team = R('', '2026-08-03T09:00', 'team', 'alice, bob, carol');
  const typed = [set, team,
    R('', '2026-08-03T09:00', 'shift', 'carol'), R('', '2026-08-10T09:00', 'shift', 'bob'), R('', '2026-08-17T09:00', 'shift', 'alice'),
  ];
  const first = run(typed, '2026-08-25T10:00');
  assert.deepEqual(shiftsIn(first.ledgers.r).slice(0, 5), [
    ['2026-08-03T09:00', 'carol', 'a'], ['2026-08-10T09:00', 'bob', 'a'], ['2026-08-17T09:00', 'alice', 'a'],
    ['2026-08-24T09:00', 'bob', 'a'], ['2026-08-31T09:00', 'carol', ''],
  ]);
  assert.deepEqual(first.ledgers.r.find((c) => c[2] === 'snapshot').slice(1, 4), ['2026-08-24T09:00', 'snapshot', 'alice=7, bob=7, carol=7']);
  assert.deepEqual(run(first.ledgers.r, '2026-08-25T10:00').ledgers.r, first.ledgers.r);
  // A gap in typed history is filled, typed rows on either side stay.
  const gappy = run([set, team, R('', '2026-08-03T09:00', 'shift', 'carol'), R('', '2026-08-17T09:00', 'shift', 'carol')], '2026-08-25T10:00');
  assert.deepEqual(shiftsIn(gappy.ledgers.r).slice(0, 4).map((s) => [s[0], s[1]]), [
    ['2026-08-03T09:00', 'carol'], ['2026-08-10T09:00', 'alice'], ['2026-08-17T09:00', 'carol'], ['2026-08-24T09:00', 'bob'],
  ]);
  // Without now, regenerate keeps typed history before S; a typed row after now is the script's and moves.
  const noNow = U.regenerate({ rotations: [{ name: 'r', rows: rows(typed.concat([R('', '2026-08-31T09:00', 'shift', 'bob')])), snapshotAt: dt('2026-08-24T09:00') }], holidays: [], global: [] });
  assert.deepEqual(shifts(noNow).map((s) => [s[0], s[1]]).slice(0, 5), [
    ['2026-08-03T09:00', 'carol'], ['2026-08-10T09:00', 'bob'], ['2026-08-17T09:00', 'alice'], ['2026-08-24T09:00', 'bob'], ['2026-08-31T09:00', 'carol'],
  ]);
});

test('relations hold across the backfilled span', () => {
  const primary = [SET(), TEAM, WEEK1, SNAP, R('a', '2026-10-12T09:00', 'shift', 'bob')];
  const secondary = [SET(), TEAM, R('a', '2026-10-05T09:00', 'shift', 'bob'), R('', '2026-10-12T09:00', 'snapshot', 'alice=0, bob=7, carol=0'), R('a', '2026-10-12T09:00', 'shift', 'carol')];
  const { result, ledgers } = run({ primary, secondary }, '2026-11-11T10:00', [R('', '2026-10-05T09:00', 'repel', 'primary, secondary')]);
  assert.deepEqual(result.errors, []);
  const byStart = {};
  ['primary', 'secondary'].forEach((name) => shiftsIn(ledgers[name]).forEach((s) => { byStart[s[0]] = (byStart[s[0]] || []).concat(s[1]); }));
  Object.keys(byStart).forEach((start) => assert.notEqual(byStart[start][0], byStart[start][1], start));
  assert.deepEqual(shiftsIn(ledgers.secondary).map((s) => s[1]).slice(2, 5), ['alice', 'bob', 'carol']);
});
