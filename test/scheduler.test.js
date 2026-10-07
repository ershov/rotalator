'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const W = 7 * 1440;
const D = 1440;
const MON = dt('2026-10-05T09:00');

const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (out, i = 0) => plain(out.rotations[i].rows.map(U.rowToArray));
const scores = (roster) => plain(roster.map((m) => ({ name: m.name, score: m.score, projected: m.projected })));
const shifts = (out, i = 0) => plain(out.rotations[i].rows.filter((r) => r.type === 'shift').map((r) => [U.formatDateTime(r.start), r.what, r.note]));
const ofType = (out, type, i = 0) => out.rotations[i].rows.filter((r) => r.type === type);

function run(cells, now, holidays = []) {
  const ledger = rows(cells);
  const S = U.advance(ledger, dt(now));
  return U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: S }], holidays, global: [] });
}

const SET = R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0');
const TEAM = R('', '2026-10-05T09:00', 'team', 'alice, bob, carol');

test('advance: shift containing now', () => {
  const ledger = rows([SET, TEAM,
    R('', '2026-10-05T09:00', 'shift', 'alice'),
    R('', '2026-10-12T09:00', 'shift', 'bob'),
  ]);
  assert.equal(U.advance(ledger, dt('2026-10-14T12:00')), dt('2026-10-12T09:00'));
  assert.equal(U.advance(ledger, dt('2026-10-12T09:00')), dt('2026-10-12T09:00'));
  assert.equal(U.advance(ledger, dt('2026-10-11T12:00')), dt('2026-10-05T09:00'));
  const pinned = rows([SET, TEAM, R('x', '2026-10-07T09:00', 'shift', 'alice', '', '2w')]);
  assert.equal(U.advance(pinned, dt('2026-10-20T12:00')), dt('2026-10-07T09:00'));
});

test('advance: grid floor when no shift covers now', () => {
  const ledger = rows([SET, TEAM, R('', '2026-10-05T09:00', 'shift', 'alice')]);
  assert.equal(U.advance(ledger, dt('2026-11-04T12:00')), dt('2026-11-02T09:00'));
  assert.equal(U.advance(ledger, dt('2026-11-02T08:59')), dt('2026-10-26T09:00'));
  assert.equal(U.advance(rows([SET, TEAM]), dt('2026-10-21T12:00')), dt('2026-10-19T09:00'));
  const gap = rows([SET, TEAM, R('', '2026-10-05T09:00', 'shift', 'alice'), R('x', '2026-11-02T09:00', 'shift', 'bob')]);
  assert.equal(U.advance(gap, dt('2026-10-14T12:00')), dt('2026-10-12T09:00'));
});

test('advance: raised to anchor', () => {
  const ledger = rows([SET, TEAM]);
  assert.equal(U.advance(ledger, dt('2026-09-30T12:00')), MON);
  const realigned = rows([R('', '2026-09-01', 'set', 'period=1w, horizon=90d, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '2026-09-01', 'team', 'alice'), R('', '2026-10-05T09:00', 'set', 'anchor')]);
  assert.equal(U.advance(realigned, dt('2026-10-07T12:00')), MON);
  assert.equal(U.advance(realigned, dt('2026-09-15T12:00')), dt('2026-09-15'));
});

test('advance: raised to the first team or join row', () => {
  const ledger = rows([SET, R('', '2026-10-19T09:00', 'team', 'alice, bob')]);
  assert.equal(U.advance(ledger, dt('2026-10-06T12:00')), dt('2026-10-19T09:00'));
  const joined = rows([SET, R('', '2026-10-14T09:00', 'join', 'alice')]);
  assert.equal(U.advance(joined, dt('2026-10-06T12:00')), dt('2026-10-14T09:00'));
  assert.equal(U.advance(rows([SET]), dt('2026-10-06T12:00')), MON);
});

test('advance: never before the existing snapshot; null now uses the ledger only', () => {
  const ledger = rows([SET, TEAM, R('', '2026-10-19T09:00', 'snapshot', 'alice=7, bob=7, carol=0')]);
  assert.equal(U.advance(ledger, dt('2026-10-06T12:00')), dt('2026-10-19T09:00'));
  assert.equal(U.advance(ledger, dt('2026-10-27T12:00')), dt('2026-10-26T09:00'));
  assert.equal(U.advance(ledger, null), dt('2026-10-19T09:00'));
  assert.equal(U.advance(rows([SET, TEAM]), null), MON);
});

test('bootstrap fills the horizon round robin and is idempotent', () => {
  const out = run([SET, TEAM], '2026-10-05T10:00');
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(cellsOf(out), [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'shift', 'alice'),
    R('', '2026-10-12T09:00', 'shift', 'bob'),
    R('', '2026-10-19T09:00', 'shift', 'carol'),
    R('', '2026-10-26T09:00', 'shift', 'alice'),
    R('', '2026-11-02T09:00', 'shift', 'bob'),
  ]);
  const again = run(cellsOf(out), '2026-10-05T10:00');
  assert.deepEqual(cellsOf(again), cellsOf(out));
  const later = run(cellsOf(out), '2026-10-11T23:00');
  assert.deepEqual(cellsOf(later), cellsOf(out));
  assert.deepEqual(scores(out.status.rotations[0].roster), [
    { name: 'alice', score: null, projected: 14 },
    { name: 'bob', score: null, projected: 14 },
    { name: 'carol', score: null, projected: 7 },
  ]);
  assert.equal(out.status.rotations[0].snapshotAt, MON);
  assert.equal(out.status.rotations[0].horizonEnd, MON + 5 * W);
});

test('a ledger whose team row is dated at S gets no snapshot row until the roster exists at S', () => {
  const today = U.recentMonday(dt('2026-10-07T12:00'));
  const cells = [R('', U.formatDateTime(today), 'set', 'period=1w, horizon=4w'), R('', U.formatDateTime(today), 'team', 'alice, bob, carol')];
  const first = U.regenerate({ rotations: [{ name: 'r', rows: U.rowsFromCells(cells), snapshotAt: U.advance(U.rowsFromCells(cells), dt('2026-10-05T10:00'), new Set()) }], holidays: [], global: [], now: dt('2026-10-05T10:00') });
  assert.deepEqual(plain(first.errors), []);
  assert.equal(ofType(first, 'snapshot').length, 0);
  assert.equal(first.status.rotations[0].snapshotAt, today);
  assert.ok(ofType(first, 'shift').length > 0);
  const written = cellsOf(first);
  assert.deepEqual(cellsOf(run(written, '2026-10-05T10:00')), written, 'idempotent without a snapshot row');
  // The template's epoch team row predates S, so a template-shaped ledger gets its snapshot on the first run.
  const template = U.templateRows(today).slice(1);
  const fresh = run(template, '2026-10-05T10:00');
  assert.deepEqual(plain(fresh.errors), []);
  assert.equal(ofType(fresh, 'snapshot').length, 1);
  assert.equal(ofType(fresh, 'snapshot')[0].what, 'alice=0, bob=0, carol=0');
  assert.deepEqual(cellsOf(run(cellsOf(fresh), '2026-10-05T10:00')), cellsOf(fresh));
  // A week later S has moved past the team row: the snapshot appears with the roster and a full replay gave the same scores.
  const next = run(written, '2026-10-13T10:00');
  const snapshot = ofType(next, 'snapshot');
  assert.equal(snapshot.length, 1);
  assert.equal(U.formatDateTime(snapshot[0].start), '2026-10-12');
  assert.match(snapshot[0].what, /^alice=\d+(\.\d+)?, bob=\d+(\.\d+)?, carol=\d+(\.\d+)?$/);
});

test('a rotation with a snapshot keeps an (empty) snapshot row when everyone leaves', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const withSnapshot = run(cellsOf(first), '2026-10-13T10:00');
  assert.equal(ofType(withSnapshot, 'snapshot').length, 1);
  const dormant = run(cellsOf(withSnapshot).concat([R('', '2026-10-14T09:00', 'leave', 'alice, bob, carol')]), '2026-10-20T10:00');
  assert.deepEqual(plain(dormant.errors.map((e) => e.message)).filter((m) => !/no eligible member/.test(m)), []);
  const snapshot = ofType(dormant, 'snapshot');
  assert.equal(snapshot.length, 1);
  assert.equal(U.formatDateTime(snapshot[0].start), '2026-10-19T09:00');
  assert.equal(snapshot[0].what, '');
  assert.deepEqual(cellsOf(run(cellsOf(dormant), '2026-10-20T10:00')), cellsOf(dormant));
});

test('epoch set and team rows replay exactly like their dated equivalents at the first instant', () => {
  const dated = run([SET, TEAM, R('', '2026-10-12T09:00', 'exclude', 'bob', '', '1w')], '2026-10-13T10:00');
  const epoch = run([
    R('', '', 'set', 'period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '', 'team', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'set', 'anchor'),
    R('', '2026-10-12T09:00', 'exclude', 'bob', '', '1w'),
  ], '2026-10-13T10:00');
  assert.deepEqual(plain(epoch.errors), []);
  const body = (out) => cellsOf(out).filter((c) => c[2] !== 'set' && c[2] !== 'team');
  assert.deepEqual(body(epoch), body(dated));
  assert.deepEqual(plain(epoch.status.rotations[0].roster.map((m) => [m.name, m.score, m.projected])), plain(dated.status.rotations[0].roster.map((m) => [m.name, m.score, m.projected])));
  const written = cellsOf(epoch);
  assert.deepEqual(written.slice(0, 3).map((c) => [c[1], c[2]]), [['', 'set'], ['', 'team'], ['2026-10-05T09:00', 'set']]);
  assert.deepEqual(cellsOf(run(written, '2026-10-13T10:00')), written);
  const sources = epoch.status.rotations[0].settings.values;
  assert.equal(sources.find((v) => v.key === 'period').source, 'rotation');
  assert.equal(sources.find((v) => v.key === 'anchor').value, '2026-10-05T09:00');
});

test('the grid needs a period and an anchor: no period is an error, no anchor and no shift a warning, a first shift anchors', () => {
  const implied = run([R('', '', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'shift', 'alice')], '2026-10-05T10:00');
  assert.deepEqual(plain(implied.errors), []);
  assert.equal(implied.regenerated, true);
  assert.deepEqual(shifts(implied).map((s) => [s[0], s[1]]), [['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'alice']]);
  const impliedSettings = implied.status.rotations[0].settings.values;
  assert.deepEqual(plain(impliedSettings.find((v) => v.key === 'anchor')), { key: 'anchor', value: '2026-10-05T09:00', source: 'implied' });
  // Any on-grid shift implies the same grid: with history trimmed to the second shift the boundaries stay
  // and the schedule starts at that shift, the earliest instant it can begin.
  const trimmed = run([R('', '', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '', 'team', 'alice, bob'), R('x', '2026-10-12T09:00', 'shift', 'bob')], '2026-10-13T10:00');
  assert.deepEqual(shifts(trimmed).map((s) => s[0]), ['2026-10-12T09:00', '2026-10-19T09:00', '2026-10-26T09:00']);
  assert.equal(shifts(trimmed)[0][1], 'bob');
  assert.equal(trimmed.status.rotations[0].settings.values.find((v) => v.key === 'anchor').value, '2026-10-12T09:00');
  // Neither an anchor row nor a shift: a warning, the rotation untouched and absent from the output.
  const noAnchor = run([R('', '', 'set', 'period=1w, horizon=5w'), R('', '', 'team', 'alice, bob')], '2026-10-05T10:00');
  assert.deepEqual(plain(noAnchor.errors), []);
  assert.equal(noAnchor.regenerated, true);
  assert.deepEqual(noAnchor.rotations, []);
  assert.deepEqual(noAnchor.status.rotations, []);
  assert.deepEqual(plain(noAnchor.status.warnings), [{ rotation: 'r', rowIndex: null, start: null, message: 'no anchor; add a dated set anchor row here or in #Global, or a first shift' }]);
  const noPeriod = run([R('', '', 'set', 'tolerance=1'), R('', '', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'set', 'anchor')], '2026-10-05T10:00');
  assert.deepEqual(plain(noPeriod.errors.map((e) => e.message)), ['r: no period in force; add period to a set row here or in #Global']);
  const nothing = run([R('', '2026-10-05T09:00', 'set', 'tolerance=1'), TEAM], '2026-10-05T10:00');
  assert.deepEqual(plain(nothing.errors.map((e) => e.message)), ['r: no period in force; add period to a set row here or in #Global']);
  // An epoch set without period followed by a dated set with period is fine: the dated row anchors the grid.
  const late = run([R('', '', 'set', 'tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w')], '2026-10-05T10:00');
  assert.deepEqual(plain(late.errors), []);
  assert.deepEqual(shifts(late).map((s) => s[1]), ['alice', 'bob', 'alice']);
  // Rows before the anchor are allowed: a team row dated before the set row that starts the grid uses the
  // grid extended backwards, and the schedule starts at the anchor.
  const teamFirst = run([R('', '2026-10-01T09:00', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, autopin=a:0')], '2026-10-05T10:00');
  assert.deepEqual(plain(teamFirst.errors), []);
  assert.deepEqual(shifts(teamFirst).map((s) => [s[0], s[1]]), [['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'alice']]);
  // A shift before an explicit anchor row implies the grid before it and is kept as history.
  const early = run([R('', '', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '', 'team', 'alice, bob'), R('', '2026-09-28T09:00', 'shift', 'alice'), R('', '2026-10-05T09:00', 'set', 'anchor')], '2026-10-05T10:00');
  assert.deepEqual(plain(early.errors), []);
  assert.deepEqual(shifts(early).map((s) => [s[0], s[1]]), [['2026-09-28T09:00', 'alice'], ['2026-10-05T09:00', 'bob'], ['2026-10-12T09:00', 'alice'], ['2026-10-19T09:00', 'bob']]);
  assert.equal(early.status.rotations[0].settings.values.find((v) => v.key === 'anchor').source, 'rotation');
  const globalAnchor = U.regenerate({
    rotations: [{ name: 'r', rows: rows([R('', '', 'set', 'tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '', 'team', 'alice, bob')]), snapshotAt: MON }],
    holidays: [], global: rows([R('', '', 'set', 'period=1w, horizon=3w'), R('', '2026-10-05T09:00', 'set', 'anchor')]),
  });
  assert.deepEqual(plain(globalAnchor.errors), []);
  assert.deepEqual(shifts(globalAnchor).map((s) => [s[0], s[1]]), [['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'alice']]);
});

test('a stale run backfills the gap with assigned shifts and resumes at the grid boundary', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  // Only the pinned first week survives: without a snapshot every unpinned shift belongs to the script.
  const stale = cellsOf(first).filter((c) => c[2] !== 'shift' || c[1] < '2026-10-19');
  const out = run(stale, '2026-11-04T10:00');
  assert.equal(U.formatDateTime(ofType(out, 'snapshot')[0].start), '2026-11-02T09:00');
  assert.equal(ofType(out, 'snapshot')[0].what, 'alice=14, bob=7, carol=7');
  assert.deepEqual(shifts(out).map((s) => [s[0], s[1]]).slice(0, 5), [
    ['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'carol'], ['2026-10-26T09:00', 'alice'], ['2026-11-02T09:00', 'bob'],
  ]);
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-11-04T10:00')), cellsOf(out));
});

test('snapshot advances, records scores at S, keeps history and the current shift, prunes the rest', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first);
  // A fresh rotation has no snapshot row yet (empty roster at S), so the second week is at index 4.
  assert.equal(cells.findIndex((c) => c[2] === 'snapshot'), -1);
  // An edit to the current shift must be pinned: unpinned shifts after the stored snapshot are regenerated.
  cells[cells.findIndex((c) => c[1] === '2026-10-12T09:00')] = R('x', '2026-10-12T09:00', 'shift', 'carol', '', '', 'edited by hand');
  const out = run(cells, '2026-10-13T10:00');
  assert.deepEqual(cellsOf(out), [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'shift', 'alice'),
    R('', '2026-10-12T09:00', 'snapshot', 'alice=7, bob=0, carol=0'),
    R('x', '2026-10-12T09:00', 'shift', 'carol', '', '', 'edited by hand'),
    R('', '2026-10-19T09:00', 'shift', 'bob'),
    R('', '2026-10-26T09:00', 'shift', 'carol'),
    R('', '2026-11-02T09:00', 'shift', 'alice'),
    R('', '2026-11-09T09:00', 'shift', 'bob'),
  ]);
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-13T10:00')), cellsOf(out));
  const third = run(cellsOf(out), '2026-10-20T10:00');
  assert.equal(ofType(third, 'snapshot')[0].what, 'alice=7, bob=0, carol=7');
  assert.equal(U.formatDateTime(ofType(third, 'snapshot')[0].start), '2026-10-19T09:00');
});

test('snapshot inside a long pinned shift credits the part before S and the rest after', () => {
  const cells = [SET, TEAM, R('x', '2026-10-05T09:00', 'shift', 'alice', '', '3w')];
  const first = run(cells, '2026-10-05T10:00');
  assert.deepEqual(shifts(first), [
    ['2026-10-05T09:00', 'alice', ''], ['2026-10-26T09:00', 'bob', ''], ['2026-11-02T09:00', 'carol', ''],
  ]);
  const second = run(cellsOf(first), '2026-10-20T10:00');
  // S stays at the pin's start, where the roster is still empty, so no snapshot row appears yet.
  assert.equal(second.status.rotations[0].snapshotAt, MON);
  assert.equal(ofType(second, 'snapshot').length, 0);
  assert.deepEqual(cellsOf(second), cellsOf(first));
  const late = run(cellsOf(first), '2026-11-03T10:00');
  assert.equal(ofType(late, 'snapshot')[0].what, 'alice=21, bob=7, carol=0');
  const stale = rows(cellsOf(first)).filter((r) => r.type !== 'snapshot');
  stale.push(U.makeRow({ type: 'snapshot', start: dt('2026-10-12T09:00'), what: 'alice=7, bob=0, carol=0' }));
  const resumed = U.regenerate({ rotations: [{ name: 'r', rows: stale, snapshotAt: dt('2026-10-19T09:00') }], holidays: [], global: [] });
  assert.equal(ofType(resumed, 'snapshot')[0].what, 'alice=14, bob=0, carol=0');
  assert.deepEqual(plain(resumed.status.rotations[0].roster.map((m) => m.projected)), [21, 14, 14]);
});

test('shuffle tiebreak is deterministic across runs and changes with seed', () => {
  const set = (seed) => R('', '2026-10-05T09:00', 'set', `period=1w, horizon=8w, tiebreak=shuffle, seed=${seed}, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0`);
  const team = R('', '2026-10-05T09:00', 'team', 'alice, bob, carol, dave, erin');
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
  cells.push(R('x', '2026-10-14T09:00', 'shift', 'carol', '', '1d', 'sub'));
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
  assert.equal(explicitEnd[0].what, 'carol');
});

test('pin inside the precredit window skips a turn; outside it does not', () => {
  const inside = run([SET, TEAM, R('x', '2026-10-12T09:00', 'shift', 'alice')], '2026-10-05T10:00');
  assert.deepEqual(shifts(inside).map((s) => s[1]), ['bob', 'alice', 'carol', 'alice', 'bob']);
  const disabled = run([
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=5w, precredit=0, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM,
    R('x', '2026-10-12T09:00', 'shift', 'alice'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(disabled).map((s) => s[1]), ['alice', 'alice', 'bob', 'carol', 'bob']);
  const farPin = R('x', '2026-11-02T09:00', 'shift', 'alice');
  const outside = run([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=7w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, farPin], '2026-10-05T10:00');
  assert.deepEqual(shifts(outside).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'alice', 'bob', 'carol']);
  const widened = run([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=7w, precredit=5sl, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, farPin], '2026-10-05T10:00');
  assert.deepEqual(shifts(widened).map((s) => s[1]), ['bob', 'carol', 'alice', 'bob', 'alice', 'carol', 'alice']);
  assert.deepEqual(cellsOf(run(cellsOf(widened), '2026-10-05T10:00')), cellsOf(widened));
});

test('pin inside the window for someone who joins after S is credited when reached', () => {
  const out = run([SET, TEAM,
    R('', '2026-10-12T09:00', 'join', 'dave'),
    R('x', '2026-10-19T09:00', 'shift', 'dave'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'dave', 'carol', 'dave']);
  assert.equal(out.status.rotations[0].roster.find((m) => m.name === 'dave').projected, 14);
});

test('a pinned shift beyond the horizon does not extend the last generated shift', () => {
  const out = run([SET, TEAM, R('x', '2026-12-14T09:00', 'shift', 'bob')], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => [s[0], s[1]]), [
    ['2026-10-05T09:00', 'alice'], ['2026-10-12T09:00', 'bob'], ['2026-10-19T09:00', 'carol'],
    ['2026-10-26T09:00', 'alice'], ['2026-11-02T09:00', 'bob'], ['2026-12-14T09:00', 'bob'],
  ]);
  assert.deepEqual(plain(out.status.rotations[0].roster.map((m) => m.projected)), [14, 21, 7]);
});

test('exclusion is honoured and closed by include', () => {
  const out = run([SET, TEAM,
    R('', '2026-10-10', 'exclude', 'bob'),
    R('', '2026-10-25', 'include', 'bob'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'carol', 'alice', 'bob', 'carol']);
  const bounded = run([SET, TEAM, R('', '2026-10-12T09:00', 'exclude', 'bob', '2026-10-19T09:00')], '2026-10-05T10:00');
  assert.deepEqual(shifts(bounded).map((s) => s[1]), ['alice', 'carol', 'bob', 'carol', 'alice']);
});

test('exclusion older than the snapshot still applies: replay runs from the top', () => {
  const first = run([SET, TEAM, R('', '2026-10-06', 'exclude', 'carol', '2026-10-30')], '2026-10-05T10:00');
  assert.deepEqual(shifts(first).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'carol']);
  const out = run(cellsOf(first), '2026-10-13T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'carol', 'carol']);
  const gone = run(cellsOf(first).concat([R('', '2026-10-11', 'leave', 'carol')]), '2026-10-13T10:00');
  assert.deepEqual(plain(gone.errors), []);
  assert.deepEqual(shifts(gone).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'alice', 'bob']);
});

test('min_distance keeps rest between shifts and is relaxed with a status warning, the note stays empty', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=4w, min_distance=2sl, tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out), [
    ['2026-10-05T09:00', 'alice', ''],
    ['2026-10-12T09:00', 'bob', ''],
    ['2026-10-19T09:00', 'alice', ''],
    ['2026-10-26T09:00', 'bob', ''],
  ]);
  assert.deepEqual(plain(out.status.warnings.map((w) => [w.rotation, U.formatDateTime(w.start), w.message])), [
    ['r', '2026-10-19T09:00', 'min_distance relaxed to 1sl'],
    ['r', '2026-10-26T09:00', 'min_distance relaxed to 1sl'],
  ]);
  assert.deepEqual(plain(out.errors), []);
  const three = run([
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=6w, min_distance=1sl, tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
    R('', '2026-10-19T09:00', 'exclude', 'carol', '', '1w'),
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
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=4w, tolerance=7, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice']);
});

test('team diff with baselines: leavers, joiners, adjustments and order', () => {
  const first = run([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=6w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first);
  cells.push(R('', '2026-10-19T09:00', 'team', 'carol, dave=max, alice, erin, bob+=10'));
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
  assert.deepEqual(scores(out.status.rotations[0].roster), [
    { name: 'carol', score: 0, projected: 14 },
    { name: 'dave', score: null, projected: 14 },
    { name: 'alice', score: 7, projected: 14 },
    { name: 'erin', score: null, projected: 14 },
    { name: 'bob', score: 0, projected: 17 },
  ]);
  const shrunk = run(cellsOf(first).concat([R('', '2026-10-19T09:00', 'team', 'bob, alice')]), '2026-10-12T10:00');
  assert.deepEqual(shifts(shrunk).map((s) => s[1]), ['alice', 'bob', 'alice', 'bob', 'alice', 'bob', 'alice']);
});

test('join with each baseline and leave', () => {
  const first = run([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=6w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM], '2026-10-05T10:00');
  const scoresAfter = (extra, now) => {
    const out = run(cellsOf(first).concat(extra), now);
    assert.deepEqual(plain(out.errors), []);
    return scores(out.status.rotations[0].roster);
  };
  const at = '2026-10-19T09:00';
  const snap = R('', '2026-10-19T09:00', 'snapshot', 'alice=7, bob=7, carol=0');
  const base = cellsOf(first).filter((c) => c[2] !== 'snapshot').concat([snap]);
  const joined = (arg) => {
    const ledger = rows(base.concat([R('', at, 'join', 'dave' + (arg ? '=' + arg : ''))]));
    const out = U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: dt('2026-10-26T09:00') }], holidays: [], global: [] });
    assert.deepEqual(plain(out.errors), []);
    assert.equal(ofType(out, 'snapshot')[0].what.split(', ')[2], 'carol=7');
    return out.status.rotations[0].roster.find((m) => m.name === 'dave').score;
  };
  assert.equal(joined(''), 7);
  assert.equal(joined('median'), 7);
  assert.equal(joined('mean'), 14 / 3);
  assert.equal(joined('min'), 0);
  assert.equal(joined('max'), 7);
  assert.equal(joined('2.5'), 2.5);
  const left = scoresAfter([R('', '2026-10-19T09:00', 'leave', 'carol')], '2026-10-12T10:00');
  assert.deepEqual(left.map((m) => m.name), ['alice', 'bob']);
});

test('period change via set realigns the grid and cuts the running claim', () => {
  const out = run([SET, TEAM, R('', '2026-10-21T09:00', 'set', 'period=2d, horizon=90d, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0')], '2026-10-05T10:00');
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
  assert.equal(ofType(later, 'snapshot')[0].what, 'alice=7, bob=7, carol=2');
});

test('unassignable slot emits a nobody shift and an error row', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob'),
    R('', '2026-10-12T09:00', 'exclude', 'alice', '', '1w'),
    R('', '2026-10-12T09:00', 'exclude', 'bob', '', '1w'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(out), [['2026-10-05T09:00', 'alice', ''], ['2026-10-12T09:00', '', ''], ['2026-10-19T09:00', 'bob', '']]);
  const errors = ofType(out, 'error');
  assert.equal(errors.length, 1);
  assert.equal(U.formatDateTime(errors[0].start), '2026-10-12T09:00');
  assert.match(errors[0].what, /no eligible member/);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].rotation, 'r');
  const cells = cellsOf(out);
  assert.ok(cells.findIndex((c) => c[2] === 'error') < cells.findIndex((c) => c[2] === 'shift' && c[3] === ''));
  assert.deepEqual(cellsOf(run(cells, '2026-10-05T10:00')), cells);
});

test('validation errors return rows unchanged plus error rows and skip regeneration', () => {
  const cells = [SET, TEAM,
    R('', '2026-10-06T09:00', 'error', 'stale'),
    R('', '2026-10-12T09:00', 'shift', 'alice, bob'),
    R('', 'nope', 'leave', 'alice'),
  ];
  const out = run(cells, '2026-10-05T10:00');
  assert.equal(out.errors.length, 2);
  assert.deepEqual(cellsOf(out), [
    SET, TEAM,
    R('', '2026-10-12T09:00', 'error', 'shift takes exactly one member id'),
    R('', '2026-10-12T09:00', 'shift', 'alice, bob'),
    R('', 'nope', 'error', 'bad start "nope"'),
    R('', 'nope', 'leave', 'alice'),
  ]);
  assert.deepEqual(plain(out.status.rotations), []);
  assert.deepEqual(plain(out.status.shifts), []);
  assert.deepEqual(plain(out.status.errors.map((e) => e.message)), ['shift takes exactly one member id', 'bad start "nope"']);
});

test('stateful errors: join of a member, leave of a stranger, no regeneration in any rotation', () => {
  const bad = [SET, TEAM, R('', '2026-10-12T09:00', 'join', 'alice')];
  const good = [SET, R('', '2026-10-05T09:00', 'team', 'dave')];
  const out = U.regenerate({
    rotations: [{ name: 'a', rows: rows(bad), snapshotAt: MON }, { name: 'b', rows: rows(good), snapshotAt: MON }],
    holidays: [], global: [],
  });
  assert.deepEqual(plain(out.errors.map((e) => [e.rotation, e.message])), [['a', 'join: "alice" is already a member']]);
  assert.deepEqual(cellsOf(out, 0), [SET, TEAM, R('', '2026-10-12T09:00', 'error', 'join: "alice" is already a member'), bad[2]]);
  assert.deepEqual(cellsOf(out, 1), good);
  const stranger = run([SET, TEAM, R('', '2026-10-12T09:00', 'leave', 'zed')], '2026-10-05T10:00');
  assert.deepEqual(plain(stranger.errors.map((e) => e.message)), ['leave: unknown member "zed"']);
  assert.equal(ofType(stranger, 'shift').length, 0);
});

test('list rows: join, leave, exclude and include with several names; score with aggregates and bare names', () => {
  const out = run([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=8w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM,
    R('', '2026-10-12T09:00', 'join', 'dave=max, erin'),
    R('', '2026-10-12T09:00', 'exclude', 'alice, bob', '', '3w', 'offsite'),
    R('', '2026-10-19T09:00', 'include', 'alice; bob'),
    R('', '2026-10-26T09:00', 'leave', 'alice, carol'),
    R('', '2026-10-26T09:00', 'score', 'bob, dave=min, erin+=100'),
  ], '2026-10-05T10:00');
  assert.deepEqual(plain(out.errors), []);
  // 10-12: dave joins at max (7), erin at the median (3.5); alice and bob are excluded, carol takes the slot.
  // 10-19: the include reopens alice and bob; bob (0) is lowest. 10-26: alice and carol leave, dave drops to
  // min (3.5), erin gets +100; bob and dave then alternate.
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'carol', 'bob', 'dave', 'bob', 'dave', 'bob', 'dave']);
  assert.deepEqual(scores(out.status.rotations[0].roster), [
    { name: 'bob', score: null, projected: 21 },
    { name: 'dave', score: null, projected: 24.5 },
    { name: 'erin', score: null, projected: 103.5 },
  ]);
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-05T10:00')), cellsOf(out));
  const partial = run([SET, TEAM, R('', '2026-10-12T09:00', 'exclude', 'alice, zed')], '2026-10-05T10:00');
  assert.deepEqual(plain(partial.errors.map((e) => e.message)), ['exclude: unknown member "zed"']);
  const twice = run([SET, TEAM, R('', '2026-10-12T09:00', 'include', 'alice')], '2026-10-05T10:00');
  assert.deepEqual(plain(twice.errors.map((e) => e.message)), ['include: no active exclusion for "alice"']);
});

test('exclude with several names older than the snapshot: the include row closes one of them on replay', () => {
  const first = run([SET, TEAM,
    R('', '2026-10-06', 'exclude', 'bob, carol', '2026-10-30'),
    R('', '2026-10-10', 'include', 'carol'),
  ], '2026-10-05T10:00');
  assert.deepEqual(shifts(first).map((s) => s[1]), ['alice', 'carol', 'alice', 'carol', 'bob']);
  const out = run(cellsOf(first), '2026-10-13T10:00');
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'carol', 'alice', 'carol', 'bob', 'bob']);
});

test('the snapshot is informational: a pre-snapshot edit rescores and reshapes the unpinned future, rows before P stay', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const second = run(cellsOf(first), '2026-10-13T10:00');
  assert.deepEqual(plain(ofType(second, 'snapshot').map((r) => [U.formatDateTime(r.start), r.what])), [['2026-10-12T09:00', 'alice=7, bob=0, carol=0']]);
  assert.deepEqual(shifts(second).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'bob', 'carol']);
  assert.deepEqual(cellsOf(run(cellsOf(second), '2026-10-13T10:00')), cellsOf(second), 'idempotent');
  // Hand the first week to carol: a row before P. Nothing before P is rewritten, the shift at P is kept, the
  // scores and the unpinned shifts after P follow the edit.
  const edited = cellsOf(second).map((c) => (c[1] === '2026-10-05T09:00' && c[2] === 'shift' ? [c[0], c[1], c[2], 'carol', c[4], c[5], c[6]] : c));
  const third = run(edited, '2026-10-13T10:00');
  assert.deepEqual(plain(third.errors), []);
  assert.deepEqual(plain(ofType(third, 'snapshot').map((r) => r.what)), ['alice=0, bob=0, carol=7']);
  assert.deepEqual(shifts(third).map((s) => s[1]), ['carol', 'bob', 'alice', 'bob', 'carol', 'alice']);
  const beforeP = (cells) => cells.filter((c) => c[1] < '2026-10-12T09:00');
  assert.deepEqual(beforeP(cellsOf(third)), beforeP(edited));
  assert.deepEqual(scores(third.status.rotations[0].roster).map((m) => [m.name, m.score]), [['alice', 0], ['bob', 0], ['carol', 7]]);
});

test('archiving: the snapshot row turned into a team row replaces the history above it', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const second = run(cellsOf(first), '2026-10-13T10:00');
  const archived = cellsOf(second).filter((c) => c[2] === 'set' || c[1] >= '2026-10-12T09:00').map((c) => (c[2] === 'snapshot' ? [c[0], c[1], 'team', c[3], c[4], c[5], c[6]] : c));
  assert.deepEqual(archived.map((c) => [c[1], c[2], c[3]]).slice(0, 3), [['2026-10-05T09:00', 'set', SET[3]], ['2026-10-12T09:00', 'team', 'alice=7, bob=0, carol=0'], ['2026-10-12T09:00', 'shift', 'bob']]);
  const out = run(archived, '2026-10-13T10:00');
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shifts(out), shifts(second).filter((s) => s[0] >= '2026-10-12T09:00'));
  assert.deepEqual(scores(out.status.rotations[0].roster).map((m) => [m.name, m.projected]), scores(second.status.rotations[0].roster).map((m) => [m.name, m.projected]));
});

test('bare anchor realigns the grid at the set row start', () => {
  const out = run([SET, TEAM, R('', '2026-10-21T12:00', 'set', 'anchor')], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[0]), [
    '2026-10-05T09:00', '2026-10-12T09:00', '2026-10-19T09:00', '2026-10-21T12:00', '2026-10-28T12:00', '2026-11-04T12:00',
  ]);
  assert.equal(out.status.rotations[0].horizonEnd, dt('2026-11-11T12:00'));
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-05T10:00')), cellsOf(out));
});

test('comments are kept in place, ignored by replay and generation, and survive a second run', () => {
  const out = run([
    R('', '', '', 'header comment'),
    SET, TEAM,
    R('', '2026-10-07', '', 'dated comment'),
    R('', '', '', 'above the exclude'),
    R('', '2026-10-12T09:00', 'exclude', 'bob', '', '1w'),
    R('', 'someday', '', 'bad start is undated'),
    R('', '', '', 'trailing'),
  ], '2026-10-05T10:00');
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'carol', 'bob', 'carol', 'alice']);
  const cells = cellsOf(out);
  assert.deepEqual(cells.map((c) => [c[1], c[2], c[3]]), [
    ['', '', 'header comment'],
    ['2026-10-05T09:00', 'set', 'period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'],
    ['2026-10-05T09:00', 'team', 'alice, bob, carol'],
    ['2026-10-05T09:00', 'shift', 'alice'],
    ['2026-10-07', '', 'dated comment'],
    ['', '', 'above the exclude'],
    ['2026-10-12T09:00', 'exclude', 'bob'],
    ['2026-10-12T09:00', 'shift', 'carol'],
    ['2026-10-19T09:00', 'shift', 'bob'],
    ['2026-10-26T09:00', 'shift', 'carol'],
    ['2026-11-02T09:00', 'shift', 'alice'],
    ['someday', '', 'bad start is undated'],
    ['', '', 'trailing'],
  ]);
  assert.deepEqual(cellsOf(run(cells, '2026-10-05T10:00')), cells);
  assert.deepEqual(cellsOf(run(cells, '2026-10-13T10:00')).map((c) => c[3]).filter((w) => /comment|above|trailing|undated/.test(w)),
    ['header comment', 'dated comment', 'above the exclude', 'bad start is undated', 'trailing']);
  assert.deepEqual(cellsOf(run(cells, '2026-10-13T10:00')).slice(-2).map((c) => c[3]), ['bad start is undated', 'trailing']);
  assert.deepEqual(plain(out.status.shifts.length), 5);
  assert.deepEqual(plain(out.status.warnings.map((w) => w.message)), ['comment row 8: unparseable start, treated as undated']);
});

test('comment above a generated shift stays above that instant across runs; a comment-only ledger is empty', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first);
  const at = cells.findIndex((c) => c[1] === '2026-10-19T09:00');
  cells.splice(at, 0, R('', '', '', 'swap this one'));
  cells.push(R('x', '2026-11-02T09:00', 'shift', 'bob', '', '', 'pinned'));
  cells.push(R('', '', '', 'last words'));
  const out = run(cells, '2026-10-05T10:00');
  const written = cellsOf(out);
  // The 10-19 shift is pruned and regenerated at the same instant; the comment keeps its place above it.
  const idx = written.findIndex((c) => c[3] === 'swap this one');
  assert.deepEqual(written[idx + 1].slice(1, 3), ['2026-10-19T09:00', 'shift']);
  assert.equal(written[written.length - 1][3], 'last words');
  assert.deepEqual(cellsOf(run(written, '2026-10-05T10:00')), written);
  const later = cellsOf(run(written, '2026-10-13T10:00'));
  assert.deepEqual(later[later.findIndex((c) => c[3] === 'swap this one') + 1].slice(1, 3), ['2026-10-19T09:00', 'shift']);
  // A comment above the snapshot row (first written once the roster exists, at 10-12) keeps that instant and
  // slot: when the snapshot moves on it ends above the row that followed it there.
  const snapAt = later.findIndex((c) => c[2] === 'snapshot');
  assert.equal(later[snapAt][1], '2026-10-12T09:00');
  later.splice(snapAt, 0, R('', '', '', 'above the snapshot'));
  const moved = cellsOf(run(later, '2026-10-20T10:00'));
  const s = moved.findIndex((c) => c[3] === 'above the snapshot');
  assert.deepEqual(moved[s + 1].slice(1, 3), ['2026-10-12T09:00', 'shift']);
  assert.equal(moved.findIndex((c) => c[2] === 'snapshot') > s, true);
  const empty = run([R('', '', '', 'nothing else')], '2026-10-05T10:00');
  assert.deepEqual(plain(empty.errors.map((e) => e.message)), ['r: ledger is empty']);
});

test('only: unlisted rotations are swept frozen, not returned, and their shifts still constrain relations', () => {
  const primary = { name: 'primary', rows: rows([SET, TEAM,
    R('', '2026-10-05T09:00', 'shift', 'alice'), R('', '2026-10-12T09:00', 'shift', 'alice'), R('', '2026-10-19T09:00', 'shift', 'alice'),
  ]), snapshotAt: MON };
  const secondary = { name: 'secondary', rows: rows([SET, TEAM]), snapshotAt: MON };
  const link = rows([R('', '2026-10-05T09:00', 'repel', 'primary, secondary')]);
  const full = U.regenerate({ rotations: [primary, secondary], holidays: [], global: link });
  assert.deepEqual(plain(full.rotations.map((r) => r.name)), ['primary', 'secondary']);
  // A full run reassigns primary's unpinned future shifts (alice, bob, carol); a scoped run keeps alice on all three.
  assert.deepEqual(shifts(full, 0).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'bob']);
  const scoped = U.regenerate({ rotations: [primary, secondary], holidays: [], global: link, only: ['secondary'] });
  assert.deepEqual(plain(scoped.errors), []);
  assert.deepEqual(plain(scoped.rotations.map((r) => r.name)), ['secondary']);
  // alice holds primary for three weeks (frozen, no slots beyond 10-19), so secondary avoids her until 10-26.
  assert.deepEqual(shifts(scoped, 0).map((s) => s[1]), ['bob', 'carol', 'bob', 'alice', 'carol']);
  assert.deepEqual(plain(scoped.status.rotations.map((r) => r.name)), ['primary', 'secondary']);
  assert.equal(scoped.status.rotations[0].snapshotAt, MON);
  assert.deepEqual(plain(scoped.status.shifts.filter((s) => s.rotation === 'primary').map((s) => s.who)), ['alice', 'alice', 'alice']);
  const unscoped = U.regenerate({ rotations: [primary, secondary], holidays: [], global: link, only: ['primary', 'secondary'] });
  assert.deepEqual(cellsOf(unscoped, 0), cellsOf(full, 0));
});

test('only: a frozen rotation keeps its snapshot and validation errors there still block the run', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const frozenRows = rows(cellsOf(first));
  const other = { name: 'b', rows: rows([SET, R('', '2026-10-05T09:00', 'team', 'dave')]), snapshotAt: dt('2026-10-12T09:00') };
  const out = U.regenerate({ rotations: [{ name: 'a', rows: frozenRows, snapshotAt: dt('2026-10-12T09:00') }, other], holidays: [], global: [], only: ['b'] });
  assert.equal(out.status.rotations[0].snapshotAt, MON);
  assert.deepEqual(plain(out.rotations.map((r) => r.name)), ['b']);
  const broken = U.regenerate({ rotations: [{ name: 'a', rows: rows([SET, TEAM, R('', '2026-10-12T09:00', 'join', 'alice')]), snapshotAt: MON }, other], holidays: [], global: [], only: ['b'] });
  assert.deepEqual(plain(broken.errors.map((e) => [e.rotation, e.message])), [['a', 'join: "alice" is already a member']]);
  assert.deepEqual(plain(broken.rotations.map((r) => r.name)), ['b']);
  assert.deepEqual(cellsOf(broken, 0), [SET, R('', '2026-10-05T09:00', 'team', 'dave')]);
});

test('score rows and skip settings affect credit', () => {
  const out = run([
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, skip_weekends=true, skip_holidays=true, tolerance=0, min_distance=0, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob'),
    R('', '2026-10-05T09:00', 'score', 'alice+=100'),
  ], '2026-10-05T10:00', [U.parseDay('2026-10-14')]);
  assert.deepEqual(shifts(out).map((s) => s[1]), ['bob', 'bob', 'bob']);
  assert.deepEqual(scores(out.status.rotations[0].roster), [
    { name: 'alice', score: null, projected: 100 },
    { name: 'bob', score: null, projected: 14 },
  ]);
});

test('multiple rotations are swept together, each with its own state', () => {
  const out = U.regenerate({
    rotations: [
      { name: 'primary', rows: rows([SET, TEAM]), snapshotAt: MON },
      { name: 'secondary', rows: rows([R('', '2026-10-05T09:00', 'set', 'period=2w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '2026-10-05T09:00', 'team', 'dave, erin')]), snapshotAt: MON },
    ],
    holidays: [], global: [],
  });
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shifts(out, 0).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'bob']);
  assert.deepEqual(shifts(out, 1).map((s) => [s[0], s[1]]), [['2026-10-05T09:00', 'dave'], ['2026-10-19T09:00', 'erin'], ['2026-11-02T09:00', 'dave']]);
  assert.deepEqual(plain(out.status.rotations.map((r) => r.name)), ['primary', 'secondary']);
});

test('regenerate without snapshotAt falls back to the ledger and never moves the snapshot back', () => {
  const first = run([SET, TEAM], '2026-10-05T10:00');
  const cells = cellsOf(first).concat([R('', '2026-10-12T09:00', 'snapshot', 'alice=7, bob=0, carol=0')]);
  const out = U.regenerate({ rotations: [{ name: 'r', rows: rows(cells) }], holidays: [], global: [] });
  assert.equal(U.formatDateTime(ofType(out, 'snapshot')[0].start), '2026-10-12T09:00');
  const back = U.regenerate({ rotations: [{ name: 'r', rows: rows(cells), snapshotAt: MON }], holidays: [], global: [] });
  assert.equal(U.formatDateTime(ofType(back, 'snapshot')[0].start), '2026-10-12T09:00');
});
