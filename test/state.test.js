'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const W = 7 * 1440;
const D = 1440;
const MON = dt('2026-10-05T09:00');

const setRow = (start, what) => U.makeRow({ type: 'set', start: dt(start), what });
const items = (text) => U.parseAssignments(text);

test('SettingsTimeline: period change sets anchor, bare anchor re-anchors, grid change reporting', () => {
  const t = (rows) => new U.SettingsTimeline(rows);
  const empty = new U.Settings();
  assert.deepEqual(plain(empty.values), plain(U.defaultSettings()));
  assert.equal(empty.grid(), null);
  const tl = t([
    setRow('2026-10-05T09:00', 'period=1w, tolerance=1'),
    setRow('2026-10-07T09:00', 'skip_weekends=true, period=1w'),
    setRow('2026-10-08T09:00', 'anchor'),
    setRow('2026-10-21T09:00', 'period=2d'),
    setRow('2026-11-02T09:00', 'period=1w, anchor'),
    setRow('2026-12-07T09:00', 'anchor'),
    setRow('2027-01-01', 'tolerance, skip_weekends'),
  ]);
  assert.deepEqual(plain(tl.entries.map((e) => e.gridChanged)), [true, false, true, true, true, true, false]);
  assert.equal(tl.at(MON).get('period'), W);
  assert.equal(tl.at(MON).get('anchor'), MON);
  assert.equal(tl.at(MON).get('tolerance'), 1);
  assert.equal(tl.at(dt('2026-10-07T09:00')).get('anchor'), MON);
  assert.equal(tl.at(dt('2026-10-07T09:00')).get('skip_weekends'), true);
  assert.equal(tl.at(dt('2026-10-08T09:00')).get('anchor'), dt('2026-10-08T09:00'));
  assert.equal(tl.at(dt('2026-10-21T09:00')).get('anchor'), dt('2026-10-21T09:00'));
  assert.equal(tl.at(dt('2026-11-02T09:00')).get('anchor'), dt('2026-11-02T09:00'));
  const grid = tl.gridAt(dt('2026-12-07T09:00'));
  assert.equal(grid.period, W);
  assert.equal(grid.anchor, dt('2026-12-07T09:00'));
  const late = tl.at(dt('2027-01-01'));
  assert.deepEqual(plain(late.get('tolerance')), plain(U.defaultSettings().tolerance));
  assert.equal(late.get('skip_weekends'), true);
  assert.deepEqual(plain(tl.at(dt('2026-10-07T09:00')).unitsOptions(new Set([1]))), { skip_weekends: true, skip_holidays: true, holidays: new Set([1]) });
  const copy = tl.at(MON);
  copy.values.tolerance = 9;
  assert.equal(tl.at(MON).get('tolerance'), 1);
});

test('interval settings are kept as written and resolved against the grid and roster size', () => {
  const tl = new U.SettingsTimeline([setRow('2026-10-05T09:00', 'period=1w, precredit=2sl'), setRow('2026-10-06T09:00', 'precredit=0')]);
  const grid = tl.gridAt(MON);
  assert.equal(U.resolveInterval(new U.Settings().get('precredit'), grid, 4), 4 * W);
  assert.equal(U.resolveInterval(tl.at(MON).get('precredit'), grid, 4), 2 * W);
  assert.equal(U.resolveInterval(tl.at(MON + D).get('precredit'), grid, 4), 0);
  assert.equal(tl.at(MON).get('precredit').text, '2sl');
});

test('SettingsTimeline: global set rows layer under the rotation; bare keys return to the global value', () => {
  const global = [
    setRow('2026-09-01', 'tolerance=7, seed=3'),
    setRow('2026-10-19T09:00', 'tolerance=2'),
  ];
  const tl = new U.SettingsTimeline([
    setRow('2026-10-05T09:00', 'period=1w'),
    setRow('2026-10-12T09:00', 'tolerance=0'),
    setRow('2026-10-26T09:00', 'tolerance'),
  ], new Set(), global);
  const at = (s) => tl.at(dt(s));
  const src = (s, key) => tl.sourcesAt(dt(s))[key];
  assert.deepEqual(plain(at('2026-08-01').get('tolerance')), plain(U.defaultSettings().tolerance));
  assert.equal(src('2026-08-01', 'tolerance'), 'default');
  assert.equal(at('2026-09-15').get('tolerance'), 7);
  assert.equal(src('2026-09-15', 'tolerance'), 'global');
  assert.equal(at('2026-09-15').get('period'), null);
  assert.equal(at('2026-10-05T09:00').get('tolerance'), 7);
  assert.equal(src('2026-10-05T09:00', 'period'), 'rotation');
  assert.equal(at('2026-10-12T09:00').get('tolerance'), 0);
  assert.equal(src('2026-10-12T09:00', 'tolerance'), 'rotation');
  // A later global change does not reach a rotation that has set the key itself.
  assert.equal(at('2026-10-19T09:00').get('tolerance'), 0);
  assert.equal(at('2026-10-26T09:00').get('tolerance'), 2);
  assert.equal(src('2026-10-26T09:00', 'tolerance'), 'global');
  assert.equal(at('2026-10-26T09:00').get('seed'), 3);
  assert.equal(src('2026-10-26T09:00', 'seed'), 'global');
  assert.equal(src('2026-10-26T09:00', 'baseline'), 'default');
  assert.deepEqual(plain(tl.entries.map((e) => U.formatDateTime(e.start))), [
    '2026-09-01', '2026-10-05T09:00', '2026-10-12T09:00', '2026-10-19T09:00', '2026-10-26T09:00',
  ]);
});

test('SettingsTimeline: global period and anchor, local period change, grid changes from both layers', () => {
  const global = [setRow('2026-10-05T09:00', 'period=1w'), setRow('2026-11-02T09:00', 'anchor')];
  const tl = new U.SettingsTimeline([setRow('2026-10-05T09:00', 'tolerance=1'), setRow('2026-10-21T09:00', 'period=2d')], new Set(), global);
  assert.equal(tl.at(MON).get('period'), W);
  assert.equal(tl.at(MON).get('anchor'), MON);
  assert.deepEqual(tl.sourcesAt(MON).period, 'global');
  assert.equal(tl.at(dt('2026-10-21T09:00')).get('period'), 2 * D);
  assert.equal(tl.at(dt('2026-10-21T09:00')).get('anchor'), dt('2026-10-21T09:00'));
  assert.equal(tl.sourcesAt(dt('2026-10-21T09:00')).anchor, 'rotation');
  // The global re-anchor at 11-02 is hidden by the rotation's own anchor.
  assert.equal(tl.at(dt('2026-11-02T09:00')).get('anchor'), dt('2026-10-21T09:00'));
  assert.deepEqual(plain(tl.gridChanges()), [MON, dt('2026-10-21T09:00')]);
  const globalOnly = new U.SettingsTimeline([], new Set(), global);
  assert.deepEqual(plain(globalOnly.gridChanges()), [MON, dt('2026-11-02T09:00')]);
  assert.equal(globalOnly.gridAt(dt('2026-11-03')).anchor, dt('2026-11-02T09:00'));
});

test('SettingsTimeline: an empty first set row follows global re-anchoring; a bare local anchor pins it', () => {
  const global = [setRow('2026-10-05T09:00', 'period=1w'), setRow('2026-10-21T09:00', 'period=2d')];
  const follows = new U.SettingsTimeline([setRow('2026-10-05T09:00', '')], new Set(), global);
  assert.equal(follows.at(MON).get('anchor'), MON);
  assert.equal(follows.sourcesAt(MON).anchor, 'global');
  assert.equal(follows.at(dt('2026-10-21T09:00')).get('anchor'), dt('2026-10-21T09:00'));
  assert.equal(follows.at(dt('2026-10-21T09:00')).get('period'), 2 * D);
  assert.deepEqual(plain(follows.gridChanges()), [MON, dt('2026-10-21T09:00')]);
  const pinned = new U.SettingsTimeline([setRow('2026-10-05T09:00', 'anchor')], new Set(), global);
  assert.equal(pinned.sourcesAt(MON).anchor, 'rotation');
  assert.equal(pinned.at(dt('2026-10-21T09:00')).get('anchor'), MON);
  assert.equal(pinned.at(dt('2026-10-21T09:00')).get('period'), 2 * D);
  assert.equal(U.formatDateTime(pinned.gridAt(dt('2026-10-21T09:00')).floor(dt('2026-10-22'))), '2026-10-21T09:00');
  assert.equal(U.formatDateTime(pinned.gridAt(dt('2026-10-23T09:00')).next(dt('2026-10-23T09:00'))), '2026-10-25T09:00');
});

test('SettingsTimeline skips set rows whose what does not parse, in either layer', () => {
  const global = [setRow('2026-10-05T09:00', 'period=1w'), setRow('2026-10-12T09:00', 'tolerance=abc'), setRow('2026-10-13T09:00', 'tolerance=3')];
  const tl = new U.SettingsTimeline([setRow('2026-10-06T09:00', 'seed=x, tolerance=9'), setRow('2026-10-07T09:00', 'seed=2')], new Set(), global);
  assert.deepEqual(plain(tl.entries.map((e) => U.formatDateTime(e.start))), ['2026-10-05T09:00', '2026-10-07T09:00', '2026-10-13T09:00']);
  assert.deepEqual(plain(tl.at(dt('2026-10-12T09:00')).get('tolerance')), plain(U.defaultSettings().tolerance));
  assert.equal(tl.at(dt('2026-10-13T09:00')).get('tolerance'), 3);
  assert.equal(tl.at(dt('2026-10-07T09:00')).get('seed'), 2);
});

test('SettingsTimeline replays set rows with start <= t and lists grid-changing rows', () => {
  const rows = [
    setRow('2026-10-21T09:00', 'period=2d'),
    setRow('2026-10-05T09:00', 'period=1w, tolerance=1'),
    setRow('2026-10-12T09:00', 'tolerance=2'),
  ];
  const timeline = new U.SettingsTimeline(rows);
  assert.equal(timeline.at(MON - 1).get('period'), null);
  assert.equal(timeline.at(MON).get('tolerance'), 1);
  assert.equal(timeline.at(MON + W).get('tolerance'), 2);
  assert.equal(timeline.at(MON + W).get('period'), W);
  const late = timeline.at(dt('2026-10-21T09:00'));
  assert.equal(late.get('period'), 2 * D);
  assert.equal(late.get('anchor'), dt('2026-10-21T09:00'));
  assert.equal(late.get('tolerance'), 2);
  assert.deepEqual(plain(timeline.gridChanges()), [MON, dt('2026-10-21T09:00')]);
  assert.equal(timeline.gridAt(MON - 1), null);
  assert.equal(timeline.gridAt(MON + W).anchor, MON);
  assert.equal(timeline.gridAt(dt('2026-10-21T09:00')).period, 2 * D);
});

test('Roster join, leave and stateful errors', () => {
  const r = new U.Roster();
  assert.equal(r.size(), 0);
  assert.equal(r.join(items('alice'), 'median'), null);
  assert.equal(r.join(items('bob=5'), 'median'), null);
  assert.equal(r.join(items('alice'), 'median'), 'join: "alice" is already a member');
  assert.deepEqual(plain(r.names()), ['alice', 'bob']);
  assert.deepEqual(plain(r.scores()), { alice: 0, bob: 5 });
  assert.equal(r.leave(['carol']), 'leave: unknown member "carol"');
  assert.equal(r.leave(['alice']), null);
  assert.deepEqual(plain(r.names()), ['bob']);
  assert.equal(r.has('alice'), false);
  assert.equal(r.join(items('alice'), 'median'), null);
  assert.equal(r.get('alice').score, 5);
  assert.equal(r.join(items('carol=max, dave'), 'min'), null);
  assert.deepEqual(plain(r.scores()), { bob: 5, alice: 5, carol: 5, dave: 5 });
  assert.equal(r.join(items('erin=20, frank=max'), 'median'), null);
  assert.equal(r.get('frank').score, 20);
  assert.equal(r.join(items('gina, erin'), 'median'), 'join: "erin" is already a member');
  assert.equal(r.has('gina'), false);
  assert.equal(r.leave(['erin', 'zed']), 'leave: unknown member "zed"');
  assert.equal(r.leave(['erin', 'frank']), null);
  assert.deepEqual(plain(r.names()), ['bob', 'alice', 'carol', 'dave']);
});

test('Roster baseline kinds', () => {
  const r = new U.Roster();
  assert.equal(r.baseline('median'), 0);
  assert.equal(r.baseline('mean'), 0);
  assert.equal(r.baseline('min'), 0);
  assert.equal(r.baseline('max'), 0);
  assert.equal(r.baseline(3.5), 3.5);
  r.fromSnapshotWhat('a=1, b=4, c=10, d=7');
  assert.equal(r.baseline('median'), 5.5);
  assert.equal(r.baseline('mean'), 5.5);
  assert.equal(r.baseline('min'), 1);
  assert.equal(r.baseline('max'), 10);
  r.join(items('e=100'), 'median');
  assert.equal(r.baseline('median'), 7);
  assert.equal(r.baseline('mean'), 24.4);
  assert.deepEqual(plain(r.names()), ['a', 'b', 'c', 'd', 'e']);
});

test('Roster team diff: leavers, joiners with baselines, reorder, adjustments after joining', () => {
  const r = new U.Roster();
  r.fromSnapshotWhat('alice=10, bob=6, carol=2');
  assert.equal(r.team(items('carol, alice, dave, erin=mean, frank=12, bob+=2, gina-=1'), 'median'), null);
  assert.deepEqual(plain(r.names()), ['carol', 'alice', 'dave', 'erin', 'frank', 'bob', 'gina']);
  const s = r.scores();
  assert.equal(s.dave, 6);
  assert.equal(s.erin, 6);
  assert.equal(s.frank, 12);
  assert.equal(s.bob, 8);
  assert.equal(s.gina, 5);
  assert.equal(r.team(items('alice=min, bob'), 'median'), null);
  assert.deepEqual(plain(r.names()), ['alice', 'bob']);
  assert.equal(r.scores().alice, 8);
  assert.equal(r.scores().bob, 8);
  assert.equal(r.team(items('bob, bob'), 'median'), 'team: duplicate member "bob"');
});

test('Roster score adjustments: numbers, aggregates, bare names', () => {
  const r = new U.Roster();
  r.fromSnapshotWhat('alice=10, bob=6');
  assert.equal(r.score(items('alice=1, bob+=2')), null);
  assert.deepEqual(plain(r.scores()), { alice: 1, bob: 8 });
  assert.equal(r.score(items('bob-=0.5')), null);
  assert.equal(r.scores().bob, 7.5);
  assert.equal(r.score(items('carol=1')), 'score: unknown member "carol"');
  assert.equal(r.score(items('alice, bob')), null);
  assert.deepEqual(plain(r.scores()), { alice: 1, bob: 7.5 });
  assert.equal(r.score(items('alice=max')), null);
  assert.equal(r.scores().alice, 7.5);
  assert.equal(r.score(items('bob=min, alice=mean')), null);
  assert.deepEqual(plain(r.scores()), { alice: 7.5, bob: 7.5 });
  assert.equal(r.score(items('alice=2, zed')), 'score: unknown member "zed"');
});

test('Roster exclusions, include closes the open one, isExcluded overlaps', () => {
  const r = new U.Roster();
  r.fromSnapshotWhat('alice=0, bob=0');
  assert.equal(r.exclude(['carol'], MON, null), 'exclude: unknown member "carol"');
  assert.equal(r.exclude(['alice', 'carol'], MON, null), 'exclude: unknown member "carol"');
  assert.equal(r.include(['alice'], MON), 'include: no active exclusion for "alice"');
  assert.equal(r.exclude(['alice'], MON, MON + W), null);
  assert.equal(r.exclude(['bob'], MON + W), null);
  assert.equal(r.isExcluded('alice', MON - W, MON), false);
  assert.equal(r.isExcluded('alice', MON - W, MON + 1), true);
  assert.equal(r.isExcluded('alice', MON + W, MON + 2 * W), false);
  assert.equal(r.isExcluded('alice', MON + 3 * D, MON + 4 * D), true);
  assert.equal(r.isExcluded('bob', MON + 10 * W, MON + 11 * W), true);
  assert.equal(r.isExcluded('bob', MON, MON + W), false);
  assert.equal(r.isExcluded('nobody', MON, MON + W), false);
  assert.equal(r.include(['bob'], MON + 3 * W), null);
  assert.equal(r.isExcluded('bob', MON + 2 * W, MON + 3 * W), true);
  assert.equal(r.isExcluded('bob', MON + 3 * W, MON + 4 * W), false);
  assert.equal(r.include(['alice'], MON + 3 * D), null);
  assert.equal(r.isExcluded('alice', MON + 3 * D, MON + 4 * D), false);
  assert.equal(r.include(['alice'], MON + 5 * D), 'include: no active exclusion for "alice"');
  assert.equal(r.exclude(['alice', 'bob'], MON + 10 * W, MON + 11 * W), null);
  assert.equal(r.isExcluded('alice', MON + 10 * W, MON + 11 * W), true);
  assert.equal(r.include(['alice', 'bob'], MON + 10 * W), null);
  assert.equal(r.isExcluded('alice', MON + 10 * W, MON + 11 * W), false);
  assert.equal(r.isExcluded('bob', MON + 10 * W, MON + 11 * W), false);
  assert.equal(r.leave(['alice']), null);
  assert.equal(r.isExcluded('alice', MON, MON + D), false);
});

test('Roster credit and snapshot round trip with two decimals', () => {
  const r = new U.Roster();
  r.fromSnapshotWhat('alice=12.5, bob=11');
  r.credit('alice', 0.125);
  r.credit('nobody', 5);
  assert.equal(r.snapshotWhat(), 'alice=12.63, bob=11');
  const back = new U.Roster();
  back.fromSnapshotWhat(r.snapshotWhat());
  assert.deepEqual(plain(back.scores()), { alice: 12.63, bob: 11 });
  assert.deepEqual(plain(back.names()), ['alice', 'bob']);
  back.credit('bob', -11.001);
  assert.equal(back.snapshotWhat(), 'alice=12.63, bob=0');
  const empty = new U.Roster();
  empty.fromSnapshotWhat('');
  assert.equal(empty.size(), 0);
  assert.equal(empty.snapshotWhat(), '');
  assert.equal(U.formatScore(-0.004), '0');
  assert.equal(U.formatScore(2), '2');
  assert.equal(U.formatScore(12.5), '12.5');
  assert.equal(U.formatScore(14), '14');
  assert.equal(U.formatScore(19.625), '19.63');
  assert.equal(U.formatScore(0), '0');
  assert.equal(U.formatScore(100), '100');
  assert.equal(U.formatScore(10.05), '10.05');
  assert.equal(U.formatScore(-3.5), '-3.5');
});

test('clipToSnapshot keeps the part after the snapshot', () => {
  assert.deepEqual(plain(U.clipToSnapshot(MON, MON + W, null)), [MON, MON + W]);
  assert.deepEqual(plain(U.clipToSnapshot(MON, MON + W, MON + D)), [MON + D, MON + W]);
  assert.deepEqual(plain(U.clipToSnapshot(MON, null, MON + D)), [MON + D, null]);
  assert.deepEqual(plain(U.clipToSnapshot(MON + W, MON + 2 * W, MON)), [MON + W, MON + 2 * W]);
  assert.equal(U.clipToSnapshot(MON, MON + W, MON + W), null);
  assert.equal(U.clipToSnapshot(MON, MON + W, MON + 2 * W), null);
});
