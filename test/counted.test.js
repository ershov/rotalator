'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const D = 1440;
const MON = dt('2026-10-05T09:00');
const at = (s) => dt(s);
const fmt = (min) => U.formatDateTime(min);

const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (out, i = 0) => plain(out.rotations[i].rows.map(U.rowToArray));
const shifts = (out, i = 0) => plain(out.rotations[i].rows.filter((r) => r.type === 'shift').map((r) => [fmt(r.start), r.what, r.note]));
const ofType = (out, type, i = 0) => out.rotations[i].rows.filter((r) => r.type === type);

function run(cells, now, holidays = []) {
  const ledger = rows(cells);
  const S = U.advance(ledger, dt(now), new Set(holidays));
  return U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: S }], holidays, links: [] });
}

const counted = (extra = {}) => Object.assign({ period: D, anchor: MON, grid: 'counted', skip_weekends: true, skip_holidays: false }, extra);

test('counted daily grid with skipped weekends: Friday runs to Monday, skipped instants project', () => {
  const g = new U.Grid(counted(), new Set());
  assert.equal(fmt(g.next(at('2026-10-09T09:00'))), '2026-10-12T09:00');
  assert.equal(fmt(g.next(at('2026-10-08T09:00'))), '2026-10-09T09:00');
  assert.equal(fmt(g.floor(at('2026-10-10T12:00'))), '2026-10-09T09:00');
  assert.equal(fmt(g.ceil(at('2026-10-10T12:00'))), '2026-10-12T09:00');
  assert.equal(fmt(g.next(at('2026-10-11T03:00'))), '2026-10-12T09:00');
  assert.equal(fmt(g.floor(at('2026-10-12T08:00'))), '2026-10-09T09:00');
  assert.equal(fmt(g.floor(at('2026-10-12T09:00'))), '2026-10-12T09:00');
  assert.equal(fmt(g.ceil(at('2026-10-12T09:00'))), '2026-10-12T09:00');
  assert.equal(fmt(g.floor(at('2026-10-02T12:00'))), '2026-10-02T09:00');
  assert.equal(fmt(g.next(at('2026-10-02T12:00'))), '2026-10-05T09:00');
  assert.equal(fmt(g.floor(at('2026-10-04T20:00'))), '2026-10-02T09:00');
  assert.equal(fmt(g.step(at('2026-10-12T09:00'), -1)), '2026-10-09T09:00');
  assert.equal(fmt(g.step(at('2026-10-09T09:00'), 2)), '2026-10-13T09:00');
  assert.equal(fmt(g.step(at('2026-10-09T09:00'), 0)), '2026-10-09T09:00');
  assert.equal(fmt(g.step(at('2026-10-10T12:00'), 1)), '2026-10-13T00:00');
});

test('counted grid with a holiday mid-week: Tuesday runs to Thursday', () => {
  const g = new U.Grid(counted({ skip_holidays: true }), new Set([U.parseDay('2026-10-07')]));
  assert.equal(fmt(g.next(at('2026-10-06T09:00'))), '2026-10-08T09:00');
  assert.equal(fmt(g.floor(at('2026-10-07T12:00'))), '2026-10-06T09:00');
  assert.equal(fmt(g.ceil(at('2026-10-07T12:00'))), '2026-10-08T09:00');
  assert.equal(fmt(g.next(at('2026-10-07T12:00'))), '2026-10-08T09:00');
  const ignored = new U.Grid(counted({ skip_holidays: false }), new Set([U.parseDay('2026-10-07')]));
  assert.equal(fmt(ignored.next(at('2026-10-06T09:00'))), '2026-10-07T09:00');
});

test('counted grid anchored inside a skipped day projects onto the boundary between counted days', () => {
  const g = new U.Grid(counted({ anchor: at('2026-10-10T09:00') }), new Set());
  assert.equal(fmt(g.floor(at('2026-10-10T09:00'))), '2026-10-12T00:00');
  assert.equal(fmt(g.ceil(at('2026-10-10T09:00'))), '2026-10-12T00:00');
  assert.equal(fmt(g.next(at('2026-10-10T09:00'))), '2026-10-13T00:00');
  assert.equal(fmt(g.floor(at('2026-10-09T12:00'))), '2026-10-09T00:00');
  assert.equal(fmt(g.next(at('2026-10-09T12:00'))), '2026-10-12T00:00');
  assert.equal(fmt(g.floor(at('2026-10-12T00:00'))), '2026-10-12T00:00');
});

test('1w in counted mode is seven counted days and drifts across weekdays', () => {
  const g = new U.Grid(counted({ period: 7 * D }), new Set());
  assert.equal(fmt(g.next(MON)), '2026-10-14T09:00');
  assert.equal(fmt(g.next(at('2026-10-14T09:00'))), '2026-10-23T09:00');
  assert.equal(fmt(g.floor(at('2026-10-20T12:00'))), '2026-10-14T09:00');
  assert.equal(fmt(g.step(MON, 2)), '2026-10-23T09:00');
  assert.equal(fmt(g.step(at('2026-10-23T09:00'), -2)), '2026-10-05T09:00');
});

test('calendar mode ignores the skip flags and step is t + n*period', () => {
  const g = new U.Grid({ period: D, anchor: MON, grid: 'calendar', skip_weekends: true, skip_holidays: true }, new Set([U.parseDay('2026-10-06')]));
  assert.equal(fmt(g.next(at('2026-10-09T09:00'))), '2026-10-10T09:00');
  assert.equal(fmt(g.next(at('2026-10-05T09:00'))), '2026-10-06T09:00');
  assert.equal(g.step(MON, 3), MON + 3 * D);
  assert.equal(g.step(MON + 17, -2), MON + 17 - 2 * D);
  const bare = new U.Grid({ period: 7 * D, anchor: MON });
  assert.equal(bare.step(MON, 1), MON + 7 * D);
});

test('grid setting: values, bare key, validation and grid-change reporting', () => {
  assert.equal(U.parseSetArg('period=1d, grid=Counted', MON).values.grid, 'counted');
  assert.equal(U.parseSetArg('grid', MON).values.grid, 'calendar');
  assert.equal(U.parseSetArg('grid=weekly', MON).error, 'bad value for grid: "weekly"');
  assert.equal(U.defaultSettings().grid, 'calendar');
  const setRow = (what) => U.makeRow({ type: 'set', start: MON, what });
  const s = new U.Settings();
  assert.equal(s.apply(setRow('period=1d')), true);
  assert.equal(s.apply(setRow('skip_weekends=true')), false);
  assert.equal(s.apply(setRow('grid=counted')), true);
  assert.equal(s.apply(setRow('skip_holidays=true')), true);
  assert.equal(s.apply(setRow('skip_holidays=true')), false);
  assert.equal(s.apply(setRow('skip_weekends=false')), true);
  assert.equal(s.apply(setRow('grid=counted')), false);
  assert.equal(s.apply(setRow('grid')), true);
  assert.equal(s.apply(setRow('skip_weekends=true')), false);
  const holidays = new Set([U.parseDay('2026-10-07')]);
  const timeline = new U.SettingsTimeline([U.makeRow({ type: 'set', start: MON, what: 'period=1d, grid=counted, skip_holidays=true' })], holidays);
  assert.equal(fmt(timeline.gridAt(MON).next(at('2026-10-06T09:00'))), '2026-10-08T09:00');
  assert.equal(fmt(s.grid(holidays).next(at('2026-10-06T09:00'))), '2026-10-07T09:00');
});

const SET = R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=1w, grid=counted, skip_weekends=true');
const TEAM = R('', '2026-10-05T09:00', 'team', 'alice, bob, carol');

test('counted daily rotation: no weekend shifts, Friday credits 1.0 through Monday, idempotent, full replay equal', () => {
  const out = run([SET, TEAM], '2026-10-05T10:00');
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shifts(out), [
    ['2026-10-05T09:00', 'alice', ''], ['2026-10-06T09:00', 'bob', ''], ['2026-10-07T09:00', 'carol', ''],
    ['2026-10-08T09:00', 'alice', ''], ['2026-10-09T09:00', 'bob', ''],
  ]);
  const friday = out.status.shifts.find((s) => s.start === at('2026-10-09T09:00'));
  assert.equal(fmt(friday.end), '2026-10-12T09:00');
  assert.deepEqual(plain(out.status.rotations[0].roster.map((m) => [m.name, m.projected])), [['alice', 2], ['bob', 2], ['carol', 1]]);
  assert.equal(out.status.rotations[0].horizonEnd, at('2026-10-12T09:00'));
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-05T10:00')), cellsOf(out));
  assert.deepEqual(cellsOf(run(cellsOf(out), '2026-10-05T20:00')), cellsOf(out));
  const weekend = run(cellsOf(out), '2026-10-10T12:00');
  assert.equal(fmt(ofType(weekend, 'snapshot')[0].start), '2026-10-09T09:00');
  assert.equal(ofType(weekend, 'snapshot')[0].what, 'alice=2.00, bob=1.00, carol=1.00');
  const replayed = run(cellsOf(weekend).filter((c) => c[2] !== 'snapshot'), '2026-10-10T12:00');
  assert.deepEqual(cellsOf(replayed), cellsOf(weekend));
  const monday = run(cellsOf(weekend), '2026-10-12T10:00');
  assert.equal(ofType(monday, 'snapshot')[0].what, 'alice=2.00, bob=2.00, carol=1.00');
  assert.equal(shifts(monday)[5][0], '2026-10-12T09:00');
});

test('a Saturday anchor or roster row never leaves the snapshot inside skipped days', () => {
  const sat = [
    R('', '2026-10-10T09:00', 'set', 'period=1d, horizon=1w, grid=counted, skip_weekends=true'),
    R('', '2026-10-10T09:00', 'team', 'alice, bob'),
  ];
  const early = run(sat, '2026-10-09T12:00');
  assert.equal(fmt(ofType(early, 'snapshot')[0].start), '2026-10-12T00:00');
  assert.equal(shifts(early)[0][0], '2026-10-12T00:00');
  assert.deepEqual(cellsOf(run(sat, '2026-10-10T12:00')), cellsOf(early));
  const lateTeam = run([SET, R('', '2026-10-10T12:00', 'team', 'alice, bob')], '2026-10-06T10:00');
  assert.equal(fmt(ofType(lateTeam, 'snapshot')[0].start), '2026-10-12T09:00');
  assert.equal(shifts(lateTeam)[0][0], '2026-10-12T09:00');
  const calendarTeam = run([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w'), R('', '2026-10-14T09:00', 'team', 'alice')], '2026-10-06T10:00');
  assert.equal(fmt(ofType(calendarTeam, 'snapshot')[0].start), '2026-10-14T09:00');
});

test('the Grid of a timeline entry is reused and a long counted horizon is fast', () => {
  const timeline = new U.SettingsTimeline([U.makeRow({ type: 'set', start: MON, what: 'period=1d, grid=counted, skip_weekends=true' })], new Set());
  assert.equal(timeline.gridAt(MON), timeline.gridAt(MON + 30 * D));
  const g = timeline.gridAt(MON);
  assert.equal(g.countedDay(7), g.countedDay(7));
  assert.equal(fmt(U.dayStart(g.countedDay(-3))), '2026-09-30T00:00');
  const started = Date.now();
  const out = run([
    R('', '2020-01-06T09:00', 'set', 'period=1d, horizon=104w, grid=counted, skip_weekends=true'),
    R('', '2020-01-06T09:00', 'team', 'alice, bob, carol'),
  ], '2020-01-06T10:00');
  assert.equal(shifts(out).length, 520);
  assert.ok(Date.now() - started < 1000, 'long counted run took ' + (Date.now() - started) + ' ms');
});

test('counted daily rotation with a holiday: Tuesday runs to Thursday and credits 1.0', () => {
  const set = R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=1w, grid=counted, skip_weekends=true, skip_holidays=true');
  const out = run([set, TEAM], '2026-10-05T10:00', [U.parseDay('2026-10-07')]);
  assert.deepEqual(shifts(out).map((s) => [s[0], s[1]]), [
    ['2026-10-05T09:00', 'alice'], ['2026-10-06T09:00', 'bob'], ['2026-10-08T09:00', 'carol'], ['2026-10-09T09:00', 'alice'],
  ]);
  const tuesday = out.status.shifts.find((s) => s.start === at('2026-10-06T09:00'));
  assert.equal(fmt(tuesday.end), '2026-10-08T09:00');
  assert.deepEqual(plain(out.status.rotations[0].roster.map((m) => m.projected)), [2, 1, 1]);
});

test('counted 1w period: boundaries every seven counted days, each credits 7', () => {
  const set = R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, grid=counted, skip_weekends=true');
  const out = run([set, TEAM], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[0]), ['2026-10-05T09:00', '2026-10-14T09:00', '2026-10-23T09:00']);
  assert.equal(out.status.rotations[0].horizonEnd, at('2026-11-03T09:00'));
  assert.deepEqual(plain(out.status.rotations[0].roster.map((m) => m.projected)), [7, 7, 7]);
});

test('min_distance is measured in grid steps: the Thursday holder is too close to Monday', () => {
  const set = R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=2w, grid=counted, skip_weekends=true, min_distance=2');
  const out = run([set, TEAM, R('', '2026-10-05T09:00', 'score', 'carol+=10')], '2026-10-05T10:00');
  assert.deepEqual(shifts(out).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'bob', 'carol', 'alice', 'bob', 'carol', 'alice']);
  assert.deepEqual(shifts(out).map((s) => s[2]), new Array(10).fill(''));
  assert.deepEqual(plain(out.status.warnings), []);
  const calendar = R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=1w, skip_weekends=true, min_distance=2');
  const plainRun = run([calendar, TEAM, R('', '2026-10-05T09:00', 'score', 'carol+=10')], '2026-10-05T10:00');
  assert.deepEqual(shifts(plainRun).map((s) => s[0]).slice(4, 7), ['2026-10-09T09:00', '2026-10-10T09:00', '2026-10-11T09:00']);
  assert.deepEqual(shifts(plainRun).map((s) => s[1]), ['alice', 'bob', 'carol', 'alice', 'bob', 'carol', 'alice']);
});

test('precredit window is measured in grid steps across the weekend', () => {
  const pin = R('x', '2026-10-13T09:00', 'shift', 'alice', '', '', 'volunteered');
  const out = run([SET, TEAM, pin], '2026-10-09T10:00');
  assert.equal(fmt(ofType(out, 'snapshot')[0].start), '2026-10-09T09:00');
  assert.deepEqual(shifts(out).map((s) => [s[0], s[1]]), [
    ['2026-10-09T09:00', 'bob'], ['2026-10-12T09:00', 'carol'], ['2026-10-13T09:00', 'alice'],
    ['2026-10-14T09:00', 'bob'], ['2026-10-15T09:00', 'carol'],
  ]);
  const narrow = R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=1w, grid=counted, skip_weekends=true, precredit=1');
  const late = run([narrow, TEAM, pin], '2026-10-09T10:00');
  assert.equal(shifts(late)[0][1], 'alice');
});
