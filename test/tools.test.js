'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const R = (pin, start, type, what, end = '', duration = '', note = '') => [pin, start, type, what, end, duration, note];
const SET = R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=4w');
const shifts = (rows) => plain(rows.map((r) => [U.formatDateTime(r.start), r.type, r.what]));
const timelineOf = (cells) => new U.SettingsTimeline(U.rowsOfType(U.rowsFromCells(cells), 'set'), new Set());

test('recentMonday: same Monday at or after 09:00, previous week before', () => {
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-07T12:00'))), '2026-10-05T09:00');
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-05T09:00'))), '2026-10-05T09:00');
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-05T08:59'))), '2026-09-28T09:00');
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-11T23:00'))), '2026-10-05T09:00');
});

test('templateRows: header, every setting at its default, sample team', () => {
  const rows = plain(U.templateRows(dt('2026-10-05T09:00')));
  assert.deepEqual(rows[0], plain(U.LEDGER_HEADER));
  assert.deepEqual(rows[1], R('', '2026-10-05T09:00', 'set',
    'period=1w, anchor, grid=calendar, horizon=90d, skip_weekends=false, skip_holidays=false, tolerance=0, min_distance=0, tiebreak=order, seed=0, baseline=median, precredit=auto'));
  assert.deepEqual(rows[2], R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'));
  const parsed = U.rowsFromCells(rows.slice(1));
  assert.deepEqual(plain(U.validateLedger(parsed, 'r').errors), []);
  const values = U.parseSetArg(parsed[0].what, parsed[0].start).values;
  assert.deepEqual(plain(values), { ...plain(U.defaultSettings()), period: 7 * 1440, anchor: dt('2026-10-05T09:00') });
});

test('gridRows: extension after the last claim, backfill before the first row', () => {
  const cells = [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob'), R('', '2026-10-12T09:00', 'shift', 'alice')];
  const out = U.gridRows(U.rowsFromCells(cells), 2, 3, timelineOf(cells));
  assert.deepEqual(shifts(out), [
    ['2026-09-21T09:00', 'shift', ''],
    ['2026-09-28T09:00', 'shift', ''],
    ['2026-10-05T09:00', 'set', 'period=1w, horizon=4w'],
    ['2026-10-05T09:00', 'team', 'alice, bob'],
    ['2026-10-05T09:00', 'shift', ''],
    ['2026-10-12T09:00', 'shift', 'alice'],
    ['2026-10-19T09:00', 'shift', ''],
    ['2026-10-26T09:00', 'shift', ''],
    ['2026-11-02T09:00', 'shift', ''],
  ]);
});

test('gridRows: gaps split at boundaries, odd ends and durations respected, non-shift rows kept', () => {
  const cells = [SET,
    R('', '2026-10-05T09:00', 'shift', 'alice', '', '2w'),
    R('', '2026-10-21T09:00', 'shift', 'bob'),
    R('', '2026-11-09T09:00', 'exclude', 'bob', '', '1w'),
    R('', '2026-11-16T09:00', 'shift', 'carol', '2026-11-18T09:00'),
  ];
  const out = U.gridRows(U.rowsFromCells(cells), 0, 2, timelineOf(cells));
  assert.deepEqual(shifts(out), [
    ['2026-10-05T09:00', 'set', 'period=1w, horizon=4w'],
    ['2026-10-05T09:00', 'shift', 'alice'],
    ['2026-10-19T09:00', 'shift', ''],
    ['2026-10-21T09:00', 'shift', 'bob'],
    ['2026-10-26T09:00', 'shift', ''],
    ['2026-11-02T09:00', 'shift', ''],
    ['2026-11-09T09:00', 'exclude', 'bob'],
    ['2026-11-09T09:00', 'shift', ''],
    ['2026-11-16T09:00', 'shift', 'carol'],
    ['2026-11-18T09:00', 'shift', ''],
    ['2026-11-23T09:00', 'shift', ''],
  ]);
});

test('gridRows: only non-shift rows, post rows start at the boundary at or after them', () => {
  const cells = [SET, R('', '2026-10-05T09:00', 'team', 'alice')];
  const out = U.gridRows(U.rowsFromCells(cells), 0, 2, timelineOf(cells));
  assert.deepEqual(shifts(out).slice(2), [['2026-10-05T09:00', 'shift', ''], ['2026-10-12T09:00', 'shift', '']]);
  const later = U.gridRows(U.rowsFromCells([SET, R('', '2026-10-07T09:00', 'join', 'bob')]), 0, 1, timelineOf(cells));
  assert.deepEqual(shifts(later).slice(1), [['2026-10-05T09:00', 'shift', ''], ['2026-10-07T09:00', 'join', 'bob'], ['2026-10-12T09:00', 'shift', '']]);
});

test('fillShiftsGridCells: template rows, blank rows, type fill, original cells kept', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob'), R('x', '2026-10-12T09:00', '', 'alice', '', '', 'keep me')];
  const selected = [R('', '', 'shift', ''), tab[2], R('', '2026-10-19 09:00', 'shift', 'bob'), R('', '', '', ''), R('', '', 'SHIFT', '')];
  const out = plain(U.fillShiftsGridCells(selected, tab, ['2026-12-25', null]));
  assert.deepEqual(out.rows, [
    R('', '2026-10-05T09:00', 'shift', ''),
    R('x', '2026-10-12T09:00', 'shift', 'alice', '', '', 'keep me'),
    R('', '2026-10-19 09:00', 'shift', 'bob'),
    R('', '2026-10-26T09:00', 'shift', ''),
    R('', '2026-11-02T09:00', 'shift', ''),
  ]);
});

test('fillShiftsGridCells: refusals', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice')];
  assert.equal(plain(U.fillShiftsGridCells([R('', '', 'shift', 'alice'), tab[1]], tab, [])).error, 'selected row 1 has content but no start');
  assert.equal(plain(U.fillShiftsGridCells([tab[1], R('', 'soon', 'shift', '')], tab, [])).error, 'selected row 2: bad start "soon"');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '', '', '')], tab, [])).error, 'the selection has no dated row to start from');
  assert.match(plain(U.fillShiftsGridCells([tab[1]], [tab[1]], [])).error, /set row with period/);
  assert.equal(plain(U.fillShiftsGridCells([R('', '2026-09-28T09:00', 'shift', '')], tab, [])).error, 'selected row 1 is dated before the first set row');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '', '', ''), R('', '2026-10-12T09:00', 'shift', 'alice')], tab, [])).error, '2 empty row(s) above would fall before the first set row');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '2026-10-12T09:00', 'shift', 'alice')], tab, [])).rows.length, 2);
});

test('fillShiftsGridCells: counted grid runs through skipped days using holidays', () => {
  const tab = [R('', '2026-10-05T09:00', 'set', 'period=1d, grid=counted, skip_weekends=true, skip_holidays=true'), R('', '2026-10-05T09:00', 'team', 'alice')];
  const selected = [R('', '2026-10-08T09:00', 'shift', 'alice'), R('', '', '', ''), R('', '', '', ''), R('', '', '', '')];
  const out = plain(U.fillShiftsGridCells(selected, tab, ['2026-10-09']));
  assert.deepEqual(out.rows.map((r) => r[1]), ['2026-10-08T09:00', '2026-10-12T09:00', '2026-10-13T09:00', '2026-10-14T09:00']);
});
