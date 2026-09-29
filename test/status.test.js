'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();
const { runStorage, statusText } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const dt = (s) => U.parseDateTime(s);
const trim = (rows) => structuredClone(rows).map((r) => { while (r.length && r[r.length - 1] === '') r.pop(); return r; });
const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];

// Monday 2026-10-05: bob excluded for ten days from the snapshot, carol pins the third week, dave alone in secondary.
const ledgers = {
  primary: [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'exclude', 'bob', '', '10d', 'travel'),
    R('x', '2026-10-19T09:00', 'shift', 'carol', '', '', 'volunteered'),
  ],
  secondary: [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'dave'),
  ],
};
const NOW = '2026-10-05T10:00';

test('status: scores, last and next shift, active exclusions, instants', () => {
  const { status, errors } = runStorage(new MemoryStorage({ ledgers, holidays: ['2026-12-25'], ignored: ['Notes'] }), NOW);
  assert.deepEqual(errors, []);
  assert.equal(status.now, NOW);
  assert.equal(status.mode, 'dry run');
  assert.deepEqual(status.tabs, { rotations: ['primary', 'secondary'], regenerated: ['primary', 'secondary'], holidays: 1, global: 0, ignored: ['Notes'] });
  const [primary, secondary] = status.rotations;
  assert.equal(primary.snapshotAt, dt('2026-10-05T09:00'));
  assert.equal(primary.previousAt, null);
  assert.equal(primary.horizonEnd, dt('2026-10-26T09:00'));
  assert.deepEqual(primary.current, { who: 'alice', start: dt('2026-10-05T09:00'), end: dt('2026-10-12T09:00') });
  assert.deepEqual(primary.next, { who: 'carol', start: dt('2026-10-12T09:00'), end: dt('2026-10-19T09:00') });
  assert.equal(status.at, dt(NOW));
  assert.deepEqual(primary.roster, [
    { name: 'alice', score: null, projected: 7, lastShift: dt('2026-10-05T09:00'), nextShift: null, exclusions: [] },
    { name: 'bob', score: null, projected: 0, lastShift: null, nextShift: null, exclusions: [{ from: dt('2026-10-05T09:00'), to: dt('2026-10-15T09:00') }] },
    { name: 'carol', score: null, projected: 14, lastShift: null, nextShift: dt('2026-10-12T09:00'), exclusions: [] },
  ]);
  assert.deepEqual(secondary.roster, [
    { name: 'dave', score: null, projected: 21, lastShift: dt('2026-10-05T09:00'), nextShift: dt('2026-10-12T09:00'), exclusions: [] },
  ]);
  assert.deepEqual(status.warnings, []);
  assert.deepEqual(status.errors, []);
});

test('status: shifts view lists every shift by start then rotation order', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers }), NOW);
  assert.deepEqual(status.shifts.map((s) => [U.formatDateTime(s.start), s.rotation, s.who]), [
    ['2026-10-05T09:00', 'primary', 'alice'],
    ['2026-10-05T09:00', 'secondary', 'dave'],
    ['2026-10-12T09:00', 'primary', 'carol'],
    ['2026-10-12T09:00', 'secondary', 'dave'],
    ['2026-10-19T09:00', 'primary', 'carol'],
    ['2026-10-19T09:00', 'secondary', 'dave'],
  ]);
  assert.deepEqual(Object.keys(status.shifts[0]), ['start', 'end', 'rotation', 'who']);
  assert.equal(status.shifts[0].end, dt('2026-10-12T09:00'));
});

test('statusRows and shiftsRows: rows, header and divider metadata', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers, ignored: ['Notes', '#old'] }), NOW);
  const out = U.statusRows(status);
  const rows = structuredClone(out.rows);
  assert.ok(rows.every((r) => r.length === 17));
  assert.deepEqual(structuredClone(out.dividerRows), []);
  assert.deepEqual(trim(rows.slice(0, 9)), [
    ['Rotalator', 'dry run', NOW],
    [],
    ['Tabs'],
    ['rotations', 'primary, secondary'],
    ['regenerated', 'primary, secondary'],
    ['holidays', '0'],
    ['global', '0'],
    ['ignored', 'Notes, #old'],
    [],
  ]);
  assert.ok(!rows.some((r) => r[0] === 'Relations'), 'no matrix without relations');
  // Block of primary: keys in columns A to C, member table from F, settings from O; 14 rows (settings tallest).
  assert.deepEqual(rows[9].slice(0, 2), ['rotation', 'primary']);
  assert.deepEqual(rows[9].slice(3, 5), ['', '']);
  assert.deepEqual(rows[9].slice(5, 12), ['member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions']);
  assert.deepEqual(rows[9].slice(12, 17), ['', '', 'settings', 'as of 2026-10-05T10:00', 'source']);
  assert.deepEqual(rows[10].slice(0, 3), ['snapshot', '2026-10-05T09:00', '']);
  assert.deepEqual(rows[11].slice(0, 2), ['horizon', '2026-10-26T09:00']);
  assert.deepEqual(rows[12].slice(0, 3), ['current', 'alice', 'until 2026-10-12T09:00']);
  assert.deepEqual(rows[13].slice(0, 3), ['next', 'carol', 'from 2026-10-12T09:00']);
  assert.deepEqual(rows[14].slice(0, 3), ['', '', '']);
  assert.deepEqual(rows[10].slice(5, 9), ['alice', 'x', '', '7']);
  assert.deepEqual(rows[11].slice(5, 12), ['bob', '', '', '0', '', '', '2026-10-05T09:00 to 2026-10-15T09:00']);
  assert.deepEqual(rows[13].slice(5, 12), ['', '', '', '', '', '', '']);
  assert.deepEqual(rows[10].slice(14, 17), ['period', '1w', 'rotation']);
  assert.deepEqual(rows[11].slice(14, 17), ['anchor', '2026-10-05T09:00', 'rotation']);
  assert.deepEqual(rows[12].slice(14, 17), ['grid', 'calendar', 'default']);
  assert.deepEqual(rows[21].slice(14, 17), ['precredit', '1ts', 'default']);
  assert.deepEqual(rows[22].slice(14, 17), ['autopin', 'a:0', 'rotation']);
  assert.deepEqual(rows[23].slice(14, 17), ['cal', '', 'default']);
  assert.deepEqual(rows[24].slice(14, 17), ['slack', '', 'default']);
  assert.deepEqual(trim([rows[25]]), [[]]);
  assert.deepEqual(rows[26].slice(0, 2), ['rotation', 'secondary']);
  assert.deepEqual(structuredClone(out.headerRows), [0, 2, 9, 26]);
  assert.ok(!rows.some((r) => r[0] === 'warnings'), 'no warnings block without warnings');
  assert.ok(!rows.some((r) => r[0] === 'errors'), 'no errors block without errors');
  assert.equal(U.formatExclusions([{ from: dt('2026-10-05T09:00'), to: null }]), '2026-10-05T09:00 to open');

  const shifts = U.shiftsRows(status);
  assert.deepEqual(structuredClone(shifts.rows), [
    ['start', 'primary', 'secondary'],
    ['2026-10-05T09:00', 'alice', 'dave'],
    [NOW, '--now--', '--now--'],
    ['2026-10-12T09:00', 'carol', 'dave'],
    ['2026-10-19T09:00', 'carol', 'dave'],
  ]);
  assert.deepEqual(structuredClone(shifts.headerRows), [0]);
  assert.deepEqual(structuredClone(shifts.dividerRows), [2]);
  assert.deepEqual(structuredClone(shifts.currentCells), [{ row: 1, col: 1 }, { row: 1, col: 2 }]);
  assert.match(statusText(status), /^Rotalator {2}dry run +2026-10-05T10:00\n/);

  const noNow = U.regenerate({ rotations: [{ name: 'p', rows: U.rowsFromCells(ledgers.primary), snapshotAt: null }], holidays: [], global: [] });
  assert.equal(noNow.status.at, null);
  const bare = U.shiftsRows(noNow.status);
  assert.deepEqual(structuredClone(bare.dividerRows), []);
  assert.deepEqual(structuredClone(bare.rows).map((r) => r.length), [2, 2, 2, 2]);
});

test('statusRowsVertical: the CLI stacks the three groups of a rotation', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers }), NOW);
  const out = U.statusRowsVertical(status);
  const rows = trim(out.rows);
  const i = rows.findIndex((r) => r[0] === 'rotation' && r[1] === 'primary');
  assert.deepEqual(rows.slice(i, i + 7), [
    ['rotation', 'primary'],
    ['snapshot', '2026-10-05T09:00'],
    ['horizon', '2026-10-26T09:00'],
    ['current', 'alice', 'until 2026-10-12T09:00'],
    ['next', 'carol', 'from 2026-10-12T09:00'],
    [],
    ['', 'member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions'],
  ]);
  assert.deepEqual(rows[i + 7].slice(0, 5), ['', 'alice', 'x', '', '7']);
  assert.deepEqual(rows[i + 11], ['', 'settings', 'as of 2026-10-05T10:00', 'source']);
  assert.deepEqual(rows[i + 12], ['', 'period', '1w', 'rotation']);
  const headers = structuredClone(out.headerRows);
  assert.ok([i, i + 6, i + 11].every((h) => headers.includes(h)));
  assert.match(statusText(status), /\nrotation  primary\nsnapshot  2026-10-05T09:00\n/);
  assert.ok(!statusText(status).includes('rotation  primary   '), 'no horizontal block in the CLI text');
});

test('status: relations matrix from pair states at now', () => {
  const three = structuredClone(ledgers);
  three.primary.push(R('', '2026-10-05T09:00', 'repel', 'secondary'));
  three.tertiary = [R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'), R('', '2026-10-05T09:00', 'team', 'erin')];
  const global = [R('', '2026-10-05T09:00', 'attract', 'secondary, tertiary', '', '1w')];
  const { status, errors } = runStorage(new MemoryStorage({ ledgers: three, global }), NOW);
  assert.deepEqual(errors, []);
  assert.deepEqual(status.relations, [
    { reader: 'primary', target: 'secondary', kind: 'repel' },
    { reader: 'secondary', target: 'tertiary', kind: 'attract' },
    { reader: 'tertiary', target: 'secondary', kind: 'attract' },
  ]);
  const out = U.statusRows(status);
  const rows = trim(out.rows);
  const i = rows.findIndex((r) => r[0] === 'Relations');
  assert.deepEqual(rows.slice(i - 1, i + 5), [
    [],
    ['Relations', 'primary', 'secondary', 'tertiary'],
    ['primary', '', '-'],
    ['secondary', '', '', '+'],
    ['tertiary', '', '+'],
    [],
  ]);
  assert.ok(structuredClone(out.headerRows).includes(i));
  // After the global row expires only the one-sided repel remains.
  const later = runStorage(new MemoryStorage({ ledgers: three, global }), '2026-10-13T10:00').status;
  assert.deepEqual(later.relations, [{ reader: 'primary', target: 'secondary', kind: 'repel' }]);
  // Without now the view is empty and the matrix omitted; a single rotation never shows one.
  const noNow = U.regenerate({ rotations: Object.keys(three).map((name) => ({ name, rows: U.rowsFromCells(three[name]), snapshotAt: null })), holidays: [], global: U.rowsFromCells(global) });
  assert.deepEqual(structuredClone(noNow.status.relations), []);
  assert.ok(!trim(U.statusRows(noNow.status).rows).some((r) => r[0] === 'Relations'));
});

test('status: effective settings at now, every key, note on a later set row', () => {
  const withLater = structuredClone(ledgers);
  withLater.primary.push(R('', '2026-10-19T09:00', 'set', 'tolerance=7, skip_weekends=true, anchor'));
  const before = runStorage(new MemoryStorage({ ledgers: withLater }), NOW).status.rotations[0].settings;
  assert.equal(before.at, dt(NOW));
  assert.equal(before.nextSetAt, dt('2026-10-19T09:00'));
  assert.deepEqual(before.values, [
    { key: 'period', value: '1w', source: 'rotation' },
    { key: 'anchor', value: '2026-10-05T09:00', source: 'rotation' },
    { key: 'grid', value: 'calendar', source: 'default' },
    { key: 'horizon', value: '3w', source: 'rotation' },
    { key: 'skip_weekends', value: 'false', source: 'rotation' },
    { key: 'skip_holidays', value: 'false', source: 'rotation' },
    { key: 'tolerance', value: '0', source: 'rotation' },
    { key: 'min_distance', value: '0', source: 'rotation' },
    { key: 'tiebreak', value: 'order', source: 'default' },
    { key: 'seed', value: '0', source: 'default' },
    { key: 'baseline', value: 'median', source: 'default' },
    { key: 'precredit', value: '1ts', source: 'default' },
    { key: 'autopin', value: 'a:0', source: 'rotation' },
    { key: 'cal', value: '', source: 'default' },
    { key: 'slack', value: '', source: 'default' },
  ]);
  const rows = trim(U.statusRows(runStorage(new MemoryStorage({ ledgers: withLater }), NOW).status).rows);
  assert.deepEqual(rows.find((r) => r[14] === 'note').slice(14), ['note', 'a set row at 2026-10-19T09:00 changes these values']);

  const after = runStorage(new MemoryStorage({ ledgers: withLater }), '2026-10-20T10:00').status.rotations[0].settings;
  assert.equal(after.nextSetAt, null);
  const value = (key) => after.values.find((v) => v.key === key).value;
  assert.equal(value('tolerance'), '7');
  assert.equal(value('skip_weekends'), 'true');
  assert.equal(value('anchor'), '2026-10-19T09:00');
  assert.equal(value('period'), '1w');
  assert.deepEqual(after.values.map((v) => v.key), Object.keys(U.SETTINGS));

  // Without now, regenerate dates the block at the snapshot.
  const rowsAtS = U.regenerate({ rotations: [{ name: 'p', rows: U.rowsFromCells(withLater.primary), snapshotAt: null }], holidays: [], global: [] });
  assert.equal(rowsAtS.status.rotations[0].settings.at, dt('2026-10-05T09:00'));
});

test('status: warnings block only when there are warnings', () => {
  const crowded = { primary: [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, min_distance=2sl, tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob'),
  ] };
  const { status } = runStorage(new MemoryStorage({ ledgers: crowded }), NOW);
  assert.ok(status.warnings.length > 0);
  const out = U.statusRows(status);
  const rows = trim(out.rows);
  const i = rows.findIndex((r) => r[0] === 'warnings');
  assert.deepEqual(rows[i - 1], []);
  assert.deepEqual(rows[i + 1], ['rotation', 'start', 'message']);
  assert.ok(structuredClone(out.headerRows).includes(i) && structuredClone(out.headerRows).includes(i + 1));
  assert.deepEqual(rows[i + 2].slice(0, 3), ['primary', '2026-10-19T09:00', 'min_distance relaxed to 1sl']);
});

test('status on validation error: errors block, no rotations, no shifts', () => {
  const broken = structuredClone(ledgers);
  broken.primary.push(R('', '2026-10-12T09:00', 'holiday', ''));
  const { status } = runStorage(new MemoryStorage({ ledgers: broken }), NOW, { write: true });
  assert.equal(status.mode, 'run');
  assert.deepEqual(status.tabs.regenerated, []);
  assert.deepEqual(status.rotations, []);
  assert.deepEqual(status.shifts, []);
  assert.deepEqual(status.errors.map((e) => [e.rotation, e.rowIndex, e.message]), [['primary', 6, 'unknown type "holiday"']]);
  const rows = trim(U.statusRows(status).rows);
  assert.deepEqual(rows.slice(-3), [
    ['errors'],
    ['rotation', 'where', 'message'],
    ['primary', 'row 6', 'unknown type "holiday"'],
  ]);
  assert.deepEqual(structuredClone(U.shiftsRows(status).rows), [['start'], [NOW]]);
  assert.deepEqual(structuredClone(U.shiftsRows(status).currentCells), []);
});

test('All shifts grid: shared start rows, nobody as -, now row after an equal start', () => {
  const mixed = {
    weekly: [
      R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=2w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
      R('', '2026-10-05T09:00', 'team', 'alice, bob'),
      R('', '2026-10-05T09:00', 'exclude', 'alice, bob', '', '1w', 'offsite'),
    ],
    daily: [
      R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=3d, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'),
      R('', '2026-10-05T09:00', 'team', 'carol'),
    ],
  };
  const { status } = runStorage(new MemoryStorage({ ledgers: mixed }), '2026-10-06T09:00');
  const out = U.shiftsRows(status);
  assert.deepEqual(structuredClone(out.rows), [
    ['start', 'weekly', 'daily'],
    ['2026-10-05T09:00', '-', 'carol'],
    ['2026-10-06T09:00', '', 'carol'],
    ['2026-10-06T09:00', '--now--', '--now--'],
    ['2026-10-07T09:00', '', 'carol'],
    ['2026-10-08T09:00', '', 'carol'],
    ['2026-10-12T09:00', 'alice', ''],
  ]);
  assert.deepEqual(structuredClone(out.dividerRows), [3]);
  // weekly is on its nobody shift from 10-05, daily on carol's 10-06 shift: one cell each.
  assert.deepEqual(structuredClone(out.currentCells), [{ row: 1, col: 1 }, { row: 2, col: 2 }]);
  assert.equal(U.NOW_MARK, '--now--');
  const noNow = U.regenerate({ rotations: Object.keys(mixed).map((name) => ({ name, rows: U.rowsFromCells(mixed[name]), snapshotAt: null })), holidays: [], global: [] });
  assert.deepEqual(structuredClone(U.shiftsRows(noNow.status).currentCells), []);
});
