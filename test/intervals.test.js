'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const fmt = (min) => U.formatDateTime(min);
const D = 1440;
const W = 7 * D;
const MON = dt('2026-10-05T09:00');

const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (out, i = 0) => plain(out.rotations[i].rows.map(U.rowToArray));
const shifts = (out, i = 0) => plain(out.rotations[i].rows.filter((r) => r.type === 'shift').map((r) => [fmt(r.start), r.what, r.note]));
const who = (out, i = 0) => shifts(out, i).map((s) => s[1]);
// The resolved end of an sl/ts duration lives on the row object; it is never written back.
const shiftEnd = (out, start) => fmt(out.rotations[0].rows.find((r) => r.type === 'shift' && r.start === dt(start)).end);

function run(cells, now, holidays = []) {
  const ledger = rows(cells);
  const S = U.advance(ledger, dt(now), new Set(holidays));
  return U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: S }], holidays, global: [] });
}

const TEAM = R('', '2026-10-05T09:00', 'team', 'alice, bob, carol');
const set = (what) => R('', '2026-10-05T09:00', 'set', what);

test('parseInterval: fractional single tokens, integer chains, sl and ts alone, rejections', () => {
  assert.deepEqual(plain(U.parseInterval('1.5w')), { text: '1.5w', unit: 'clock', amount: 1.5, minutes: 15120 });
  assert.deepEqual(plain(U.parseInterval(' 0.5d ')), { text: '0.5d', unit: 'clock', amount: 0.5, minutes: 720 });
  assert.deepEqual(plain(U.parseInterval('90d')), { text: '90d', unit: 'clock', amount: 90, minutes: 129600 });
  assert.deepEqual(plain(U.parseInterval('1d12h')), { text: '1d12h', unit: 'clock', amount: null, minutes: 2160 });
  assert.deepEqual(plain(U.parseInterval('2sl')), { text: '2sl', unit: 'sl', amount: 2, minutes: null });
  assert.deepEqual(plain(U.parseInterval('0.5ts')), { text: '0.5ts', unit: 'ts', amount: 0.5, minutes: null });
  assert.deepEqual(plain(U.parseInterval('0')), { text: '0', unit: 'clock', amount: 0, minutes: 0 });
  assert.equal(U.parseInterval('0.50sl').text, '0.5sl');
  for (const bad of ['1sl2d', '2d1sl', '1sl1ts', '1.5d12h', '1d1.5h', 'sl', 'ts', '2SL', '1', '-1d', '0.01d', '0.5m', '0.001w', '', null]) {
    assert.equal(U.parseInterval(bad), null, String(bad));
  }
  assert.equal(U.parseDuration('2sl'), null);
  assert.equal(U.parseDuration('1.5w'), 15120);
  assert.equal(U.parseInterval('0.5h').minutes, 30);
  assert.equal(U.parseInterval('0.25d').minutes, 360);
});

test('resolveInterval and Grid.offset in calendar and counted mode', () => {
  const calendar = new U.Grid({ period: W, anchor: MON, grid: 'calendar' }, new Set());
  assert.equal(U.resolveInterval(U.parseInterval('2sl'), calendar, 3), 2 * W);
  assert.equal(U.resolveInterval(U.parseInterval('1ts'), calendar, 3), 3 * W);
  assert.equal(U.resolveInterval(U.parseInterval('0.5ts'), calendar, 4), 2 * W);
  assert.equal(U.resolveInterval(U.parseInterval('3d'), calendar, 3), 3 * D);
  assert.equal(calendar.offset(MON, 3 * D), MON + 3 * D);
  const counted = new U.Grid({ period: D, anchor: MON, grid: 'counted', skip_weekends: true }, new Set());
  assert.equal(fmt(counted.offset(dt('2026-10-08T09:00'), U.resolveInterval(U.parseInterval('2d'), counted, 3))), '2026-10-12T09:00');
  assert.equal(fmt(counted.offset(dt('2026-10-08T09:00'), U.resolveInterval(U.parseInterval('1sl'), counted, 3))), '2026-10-09T09:00');
  assert.equal(fmt(counted.offset(dt('2026-10-09T09:00'), U.resolveInterval(U.parseInterval('1ts'), counted, 3))), '2026-10-14T09:00');
});

test('min_distance in sl, ts and clock units gives the same windows in calendar mode', () => {
  const base = (what) => run([set(what), TEAM, R('', '2026-10-19T09:00', 'exclude', 'carol', '', '1w')], '2026-10-05T10:00');
  const expected = ['alice', 'bob', 'alice', 'carol', 'bob', 'carol'];
  assert.deepEqual(who(base('period=1w, horizon=6w, min_distance=1sl')), expected);
  assert.deepEqual(who(base('period=1w, horizon=6w, min_distance=1w')), expected);
  assert.deepEqual(who(base('period=1w, horizon=6w, min_distance=7d')), expected);
  // 1ts with two members is two weeks: from the third slot on it relaxes one shift length.
  const two = R('', '2026-10-05T09:00', 'team', 'alice, bob');
  const cycle = run([set('period=1w, horizon=3w, min_distance=1ts, tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), two], '2026-10-05T10:00');
  assert.deepEqual(shifts(cycle).map((s) => s[2]), ['', '', ''], 'notes stay empty');
  assert.deepEqual(plain(cycle.status.warnings.map((w) => w.message)), ['min_distance relaxed to 1sl']);
  // A fractional distance keeps its remainder on the last step.
  const half = run([set('period=1w, horizon=3w, min_distance=1.5sl, tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), two], '2026-10-05T10:00');
  assert.deepEqual(plain(half.status.warnings.map((w) => w.message)), ['min_distance relaxed to 0.5sl']);
});

test('min_distance in counted mode: 2d equals 2sl on a daily grid and skips the weekend', () => {
  const counted = (distance) => run([
    R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=10d, grid=counted, skip_weekends=true, tolerance=0, skip_holidays=false, autopin=a:0, min_distance=' + distance),
    TEAM, R('', '2026-10-05T09:00', 'score', 'carol+=10'),
  ], '2026-10-05T10:00');
  const strict = ['alice', 'bob', 'carol', 'alice', 'bob', 'carol', 'alice', 'bob', 'carol', 'alice'];
  assert.deepEqual(who(counted('2d')), strict);
  assert.deepEqual(who(counted('2sl')), strict);
  assert.deepEqual(who(counted('1ts')), who(counted('3sl')));
});

test('ts follows the roster size at the instant: precredit and duration change with a join', () => {
  const pin = R('x', '2026-10-26T09:00', 'shift', 'alice', '', '', 'volunteered');
  const small = R('', '2026-10-05T09:00', 'team', 'alice, bob');
  const join = R('', '2026-10-12T09:00', 'join', 'carol, dave');
  // Two members at S: 1ts is two weeks, the pin in week four is outside and alice takes the first slot.
  const two = run([set('period=1w, horizon=6w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), small, join, pin], '2026-10-05T10:00');
  assert.equal(who(two)[0], 'alice');
  // Four members at S: 1ts is four weeks, the pin is inside and alice skips the first slot.
  const four = run([set('period=1w, horizon=6w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '2026-10-05T09:00', 'team', 'alice, bob, carol, dave'), pin], '2026-10-05T10:00');
  assert.equal(who(four)[0], 'bob');
  // A 1ts duration dated after the join spans four weeks; dated before it, two.
  const later = run([set('period=1w, horizon=8w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), small, join, R('x', '2026-10-19T09:00', 'shift', 'alice', '', '1ts')], '2026-10-05T10:00');
  assert.equal(shiftEnd(later, '2026-10-19T09:00'), '2026-11-16T09:00');
  const earlier = run([set('period=1w, horizon=8w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), small, join, R('x', '2026-10-05T09:00', 'shift', 'alice', '', '1ts')], '2026-10-05T10:00');
  assert.equal(shiftEnd(earlier, '2026-10-05T09:00'), '2026-10-19T09:00');
  assert.equal(cellsOf(earlier).find((c) => c[0] === 'x')[5], '1ts');
});

test('precredit default 1ts equals the old auto: a window of roster-size shifts', () => {
  const pinned = [TEAM, R('x', '2026-10-12T09:00', 'shift', 'alice')];
  const byDefault = run([set('period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0')].concat(pinned), '2026-10-05T10:00');
  const explicit = run([set('period=1w, horizon=5w, precredit=3sl, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0')].concat(pinned), '2026-10-05T10:00');
  assert.deepEqual(who(byDefault), ['bob', 'alice', 'carol', 'alice', 'bob']);
  assert.deepEqual(shifts(byDefault), shifts(explicit));
  assert.equal(byDefault.status.rotations[0].settings.values.find((v) => v.key === 'precredit').value, '1ts');
});

test('tolerance suffixes: sl honours skipped days, ts scales by roster size, clock units are nominal days', () => {
  // alice starts 11 ahead; after two slots the others have 5. A band of 5 (one weekly shift with skipped
  // weekends) keeps her out of the third slot; a band of 7 lets her in.
  const old = (what) => what + (what.includes('skip_weekends') ? '' : ', skip_weekends=false') + ', min_distance=0, skip_holidays=false, autopin=a:0';
  const ahead = (what) => run([set(old(what)), TEAM, R('', '2026-10-05T09:00', 'score', 'alice+=11')], '2026-10-05T10:00');
  const out = ['bob', 'carol', 'bob'];
  const inBand = ['bob', 'carol', 'alice'];
  assert.deepEqual(who(ahead('period=1w, horizon=3w, skip_weekends=true, tolerance=1sl')), out);
  assert.deepEqual(who(ahead('period=1w, horizon=3w, skip_weekends=true, tolerance=5')), out);
  assert.deepEqual(who(ahead('period=1w, horizon=3w, skip_weekends=true, tolerance=1w')), inBand);
  assert.deepEqual(who(ahead('period=1w, horizon=3w, skip_weekends=true, tolerance=7')), inBand);
  assert.deepEqual(who(ahead('period=1w, horizon=3w, tolerance=1sl')), inBand);
  assert.deepEqual(who(ahead('period=1w, horizon=3w, skip_weekends=true, tolerance=0.5ts')), inBand);
  assert.deepEqual(who(ahead('period=1w, horizon=3w, skip_weekends=true, tolerance=0.5d')), out);
  assert.equal(ahead('period=1w, tolerance=1sl').status.rotations[0].settings.values.find((v) => v.key === 'tolerance').value, '1sl');
});

test('advance resolves sl durations before looking for the shift containing now', () => {
  const pinned = (duration) => rows([set('period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, R('x', '2026-10-05T09:00', 'shift', 'carol', '', duration)]);
  assert.equal(fmt(U.advance(pinned('2w'), dt('2026-10-14T12:00'))), '2026-10-05T09:00');
  assert.equal(fmt(U.advance(pinned('2sl'), dt('2026-10-14T12:00'))), '2026-10-05T09:00');
  assert.equal(fmt(U.advance(pinned('1sl'), dt('2026-10-14T12:00'))), '2026-10-12T09:00');
  const out = run([set('period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, R('x', '2026-10-05T09:00', 'shift', 'carol', '', '2sl')], '2026-10-14T12:00');
  // The roster is empty at S (team row at the same instant), so no snapshot row is written; the status shows S.
  assert.equal(out.rotations[0].rows.some((r) => r.type === 'snapshot'), false);
  assert.equal(fmt(out.status.rotations[0].snapshotAt), '2026-10-05T09:00');
});

test('duration in sl on a pin and on an exclude, in calendar and counted mode', () => {
  const weekly = run([set('period=1w, horizon=5w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, R('x', '2026-10-12T09:00', 'shift', 'carol', '', '2sl')], '2026-10-05T10:00');
  assert.deepEqual(shifts(weekly).map((s) => s[0]), ['2026-10-05T09:00', '2026-10-12T09:00', '2026-10-26T09:00', '2026-11-02T09:00']);
  assert.equal(shiftEnd(weekly, '2026-10-12T09:00'), '2026-10-26T09:00');
  assert.equal(cellsOf(weekly).find((c) => c[0] === 'x')[5], '2sl');
  assert.deepEqual(cellsOf(run(cellsOf(weekly), '2026-10-05T10:00')), cellsOf(weekly));
  const counted = run([
    R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=5d, grid=counted, skip_weekends=true, tolerance=0, min_distance=0, skip_holidays=false, autopin=a:0'), TEAM,
    R('x', '2026-10-08T09:00', 'shift', 'carol', '', '2sl'),
  ], '2026-10-05T10:00');
  assert.equal(shiftEnd(counted, '2026-10-08T09:00'), '2026-10-12T09:00');
  assert.deepEqual(shifts(counted).map((s) => s[0]), ['2026-10-05T09:00', '2026-10-06T09:00', '2026-10-07T09:00', '2026-10-08T09:00']);
  const excluded = run([set('period=1w, horizon=4w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, R('', '2026-10-12T09:00', 'exclude', 'alice', '', '1ts')], '2026-10-05T10:00');
  assert.deepEqual(who(excluded), ['alice', 'bob', 'carol', 'bob']);
  const halfDay = run([set('period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, R('x', '2026-10-07T09:00', 'shift', 'carol', '', '0.5d', 'cover')], '2026-10-05T10:00');
  assert.equal(shiftEnd(halfDay, '2026-10-07T09:00'), '2026-10-07T21:00');
  assert.equal(cellsOf(halfDay).find((c) => c[0] === 'x')[5], '0.5d');
});

test('interval settings are validated with hints; #Global relation rows take clock durations only', () => {
  const bad = run([set('period=1w, min_distance=2, horizon=90d, tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM], '2026-10-05T10:00');
  assert.match(bad.errors[0].message, /bad value for min_distance: "2"; use an interval like 2sl, 1ts, 3d or 0/);
  const badDuration = run([set('period=1w, horizon=90d, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM, R('x', '2026-10-12T09:00', 'shift', 'alice', '', '2x')], '2026-10-05T10:00');
  assert.match(badDuration.errors[0].message, /bad duration "2x"; use a positive interval like 2sl, 1ts or 3d/);
  const global = U.regenerate({
    rotations: [{ name: 'a', rows: rows([set('period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM]), snapshotAt: MON }, { name: 'b', rows: rows([set('period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), TEAM]), snapshotAt: MON }],
    holidays: [], global: rows([R('', '2026-10-05T09:00', 'repel', 'a, b', '', '2sl'), R('', '2026-10-05T09:00', 'repel', 'a, b', '', '2w')]),
  });
  assert.deepEqual(plain(global.errors.map((e) => e.message)), ['duration in #Global takes clock units only']);
  assert.deepEqual(who(global, 1), ['bob', 'carol', 'alice']);
});
