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
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'exclude', 'bob', '', '10d', 'travel'),
    R('x', '2026-10-19T09:00', 'shift', 'carol', '', '', 'volunteered'),
  ],
  secondary: [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w'),
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
  assert.deepEqual(status.shifts.map((s) => [U.formatDateTime(s.start), U.formatDateTime(s.end), s.rotation, s.who, s.pinned, s.note]), [
    ['2026-10-05T09:00', '2026-10-12T09:00', 'primary', 'alice', false, ''],
    ['2026-10-05T09:00', '2026-10-12T09:00', 'secondary', 'dave', false, ''],
    ['2026-10-12T09:00', '2026-10-19T09:00', 'primary', 'carol', false, ''],
    ['2026-10-12T09:00', '2026-10-19T09:00', 'secondary', 'dave', false, ''],
    ['2026-10-19T09:00', '2026-10-26T09:00', 'primary', 'carol', true, 'volunteered'],
    ['2026-10-19T09:00', '2026-10-26T09:00', 'secondary', 'dave', false, ''],
  ]);
});

test('statusRows and shiftsRows: rows, header and divider metadata', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers, ignored: ['Notes', '#old'] }), NOW);
  const out = U.statusRows(status);
  const rows = trim(out.rows);
  assert.ok(structuredClone(out.rows).every((r) => r.length === 8));
  assert.deepEqual(structuredClone(out.dividerRows), []);
  assert.deepEqual(rows.slice(0, 8), [
    ['Rotalator', 'dry run', NOW],
    [],
    ['tabs'],
    ['rotations', 'primary, secondary'],
    ['regenerated', 'primary, secondary'],
    ['holidays', '0'],
    ['global', '0'],
    ['ignored', 'Notes, #old'],
  ]);
  assert.deepEqual(rows.slice(8, 16), [
    [],
    ['rotation', 'primary'],
    ['snapshot', '2026-10-05T09:00'],
    ['horizon', '2026-10-26T09:00'],
    ['current', 'alice', 'until 2026-10-12T09:00'],
    ['next', 'carol', 'from 2026-10-12T09:00'],
    [],
    ['', 'member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions'],
  ]);
  assert.deepEqual(rows[16], ['', 'alice', 'x', '', '7', '2026-10-05T09:00']);
  assert.deepEqual(rows[17], ['', 'bob', '', '', '0', '', '', '2026-10-05T09:00 to 2026-10-15T09:00']);
  assert.deepEqual(rows.slice(19, 23), [
    [],
    ['', 'settings', 'as of 2026-10-05T10:00'],
    ['', 'period', '1w', 'rotation'],
    ['', 'anchor', '2026-10-05T09:00', 'rotation'],
  ]);
  const headers = structuredClone(out.headerRows);
  assert.deepEqual(headers.slice(0, 5), [0, 2, 9, 15, 20]);
  assert.ok(headers.every((i) => rows[i].some((c) => c !== '')));
  assert.equal(headers.length, 2 + 2 * 3);
  assert.ok(!rows.some((r) => r[0] === 'warnings'), 'no warnings block without warnings');
  assert.ok(!rows.some((r) => r[0] === 'errors'), 'no errors block without errors');
  assert.equal(U.formatExclusions([{ from: dt('2026-10-05T09:00'), to: null }]), '2026-10-05T09:00 to open');

  const shifts = U.shiftsRows(status);
  const srows = structuredClone(shifts.rows);
  assert.deepEqual(srows[0], ['pin', 'start', 'end', 'rotation', 'who', 'note']);
  assert.deepEqual(srows[1], ['', '2026-10-05T09:00', '2026-10-12T09:00', 'primary', 'alice', '']);
  assert.deepEqual(srows[3], ['', NOW, '', 'now', '', '']);
  assert.deepEqual(srows[6], ['x', '2026-10-19T09:00', '2026-10-26T09:00', 'primary', 'carol', 'volunteered']);
  assert.equal(srows.length, 8);
  assert.deepEqual(structuredClone(shifts.headerRows), [0]);
  assert.deepEqual(structuredClone(shifts.dividerRows), [3]);
  assert.match(statusText(status), /^Rotalator {2}dry run +2026-10-05T10:00\n/);

  const noNow = U.regenerate({ rotations: [{ name: 'p', rows: U.rowsFromCells(ledgers.primary), snapshotAt: null }], holidays: [], global: [] });
  assert.equal(noNow.status.at, null);
  const bare = U.shiftsRows(noNow.status);
  assert.deepEqual(structuredClone(bare.dividerRows), []);
  assert.equal(structuredClone(bare.rows).length, 4);
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
    { key: 'skip_weekends', value: 'false', source: 'default' },
    { key: 'skip_holidays', value: 'false', source: 'default' },
    { key: 'tolerance', value: '0', source: 'default' },
    { key: 'min_distance', value: '0', source: 'default' },
    { key: 'tiebreak', value: 'order', source: 'default' },
    { key: 'seed', value: '0', source: 'default' },
    { key: 'baseline', value: 'median', source: 'default' },
    { key: 'precredit', value: 'auto', source: 'default' },
  ]);
  const rows = trim(U.statusRows(runStorage(new MemoryStorage({ ledgers: withLater }), NOW).status).rows);
  assert.deepEqual(rows.find((r) => r[1] === 'note'), ['', 'note', 'a set row at 2026-10-19T09:00 changes these values']);

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
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, min_distance=2'),
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
  assert.deepEqual(rows[i + 2].slice(0, 3), ['primary', '2026-10-19T09:00', 'min_distance relaxed to 1']);
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
  assert.deepEqual(structuredClone(U.shiftsRows(status).rows), [['pin', 'start', 'end', 'rotation', 'who', 'note'], ['', NOW, '', 'now', '', '']]);
});

test('All shifts: original pin text and current rows per rotation', () => {
  const mixed = {
    weekly: [
      R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=2w'),
      R('', '2026-10-05T09:00', 'team', 'alice, bob'),
      R('keep', '2026-10-12T09:00', 'shift', 'bob', '', '', 'pinned with a word'),
      R('TRUE', '2026-10-19T09:00', 'shift', 'alice', '', '', 'ticked checkbox'),
    ],
    daily: [
      R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=3d'),
      R('', '2026-10-05T09:00', 'team', 'carol'),
    ],
  };
  const { status } = runStorage(new MemoryStorage({ ledgers: mixed }), NOW);
  assert.deepEqual(status.shifts.filter((s) => s.pinned).map((s) => s.pin), ['keep', 'TRUE']);
  const out = U.shiftsRows(status);
  const rows = structuredClone(out.rows);
  assert.deepEqual(rows.find((r) => r[0] === 'keep'), ['keep', '2026-10-12T09:00', '2026-10-19T09:00', 'weekly', 'bob', 'pinned with a word']);
  assert.deepEqual(rows.find((r) => r[5] === 'ticked checkbox').slice(0, 2), ['x', '2026-10-19T09:00']);
  assert.equal(U.pinMarker('true'), 'x');
  const current = structuredClone(out.currentRows).map((i) => rows[i]);
  assert.deepEqual(current, [
    ['', '2026-10-05T09:00', '2026-10-12T09:00', 'weekly', 'alice', ''],
    ['', '2026-10-05T09:00', '2026-10-06T09:00', 'daily', 'carol', ''],
  ]);
  assert.deepEqual(structuredClone(U.statusRows(status).currentRows), []);
  const noNow = U.regenerate({ rotations: [{ name: 'w', rows: U.rowsFromCells(mixed.weekly), snapshotAt: null }], holidays: [], global: [] });
  assert.deepEqual(structuredClone(U.shiftsRows(noNow.status).currentRows), []);
});
