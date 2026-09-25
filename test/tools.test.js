'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const R = (pin, start, type, what, end = '', duration = '', note = '') => [pin, start, type, what, end, duration, note];
const SET = R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=4w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0');
const shifts = (rows) => plain(rows.map((r) => [U.formatDateTime(r.start), r.type, r.what]));
const timelineOf = (cells) => new U.SettingsTimeline(U.rowsOfType(U.rowsFromCells(cells), 'set'), new Set());

test('recentMonday: most recent Monday 00:00 at or before t', () => {
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-07T12:00'))), '2026-10-05');
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-05'))), '2026-10-05');
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-04T23:59'))), '2026-09-28');
  assert.equal(U.formatDateTime(U.recentMonday(dt('2026-10-11T23:00'))), '2026-10-05');
});

const SET_DEFAULTS = 'period=1w, grid=calendar, horizon=20w, skip_weekends=true, skip_holidays=true, tolerance=0.5sl, min_distance=0.5ts, tiebreak=order, seed=0, baseline=median, precredit=1ts, autopin=a:2sl';

test('templateRows: header, help comments, epoch set and team rows, dated set anchor', () => {
  const rows = plain(U.templateRows(dt('2026-10-05T09:00')));
  assert.deepEqual(rows[0], plain(U.LEDGER_HEADER));
  assert.deepEqual(rows.slice(1, 9).map((r) => r[6]), [
    'ROWS:',
    'shift: one member, or nobody',
    'team / score: name, name=baseline, name=number, name+=n, name-=n [, ...]',
    'join: name, name=baseline, name=number [, ...]',
    'leave: name [, name ...]',
    'exclude / include: name [, name ...]',
    'set: key, key=value',
    'set / team without start: apply from the beginning; the dated set anchor row fixes where shifts start',
  ]);
  assert.ok(rows.slice(1, 9).every((r) => r.slice(0, 6).every((c) => c === '')), 'help rows are undated comments');
  assert.deepEqual(rows[9], R('', '', 'set', SET_DEFAULTS));
  assert.deepEqual(rows[10], R('', '', 'team', 'alice, bob, carol'));
  assert.deepEqual(rows[11], R('', '2026-10-05T09:00', 'set', 'anchor'));
  assert.equal(rows.length, 12);
  const parsed = U.rowsFromCells(rows.slice(1));
  assert.deepEqual(plain(U.validateLedger(parsed, 'r').errors), []);
  const epochSet = parsed.find((r) => r.type === 'set');
  assert.ok(U.isEpochRow(epochSet));
  const values = U.parseSetArg(epochSet.what, epochSet.start).values;
  const expected = { ...plain(U.defaultSettings()), period: 7 * 1440 };
  delete expected.anchor;
  assert.deepEqual(plain(values), expected);
  assert.equal('anchor' in values, false);
  // The help comments attach to the epoch set row; epoch rows sort first, the dated anchor row after them.
  assert.deepEqual(U.sortRows(parsed).map((r) => r.type).slice(7, 11), ['comment', 'set', 'team', 'set']);
  const timeline = new U.SettingsTimeline(U.rowsOfType(parsed, 'set'), new Set());
  assert.equal(timeline.gridStart(), dt('2026-10-05T09:00'));
  assert.equal(timeline.at(dt('2026-10-05T09:00')).get('anchor'), dt('2026-10-05T09:00'));
});

test('HELP_TEXT covers every row type, setting, interval unit and menu item', () => {
  const text = structuredClone(U.HELP_TEXT).join('\n');
  assert.ok(U.HELP_TEXT.length > 20 && U.HELP_TEXT.length < 80);
  for (const type of Object.keys(U.ROW_TYPES)) assert.match(text, new RegExp(`(^|[^a-z_])${type}([^a-z_]|$)`, 'm'), type);
  for (const key of Object.keys(U.SETTINGS)) assert.match(text, new RegExp(`^${key}(=|:)`, 'm'), key);
  for (const word of ['comment', 'sl:', 'ts:', 'Run - dry run', 'Set Up Spreadsheet', 'Set Up Tab', 'Fill Shifts Grid', 'Install nightly trigger', 'README.md', 'INSTALL.md']) assert.ok(text.includes(word), word);
  assert.equal(U.HELP_TEXT[0], 'ROTALATOR');
  const headings = structuredClone(U.helpHeadingRows());
  assert.equal(headings[0], 0);
  U.HELP_TEXT.forEach((line, i) => { if (line.endsWith(':')) assert.ok(headings.includes(i), `heading ${i}`); });
  headings.forEach((i) => assert.ok(i === 0 || U.HELP_TEXT[i].endsWith(':'), `row ${i}`));
  assert.ok(headings.length >= 6);
  assert.ok(U.isKnownSystemTab(U.HELP_TAB) && U.isSystemTab(U.HELP_TAB));
});

test('globalTemplateRows and holidaysTemplateRows', () => {
  const rows = plain(U.globalTemplateRows());
  assert.deepEqual(rows[0], plain(U.LEDGER_HEADER));
  assert.deepEqual(rows.slice(1, 5).map((r) => r[6]), ['ROWS:', 'repel / attract / detach: Rotation1, Rotation2', 'set: key, key=value', 'set / repel / attract without start: apply from the beginning']);
  assert.deepEqual(rows[5], R('', '', 'set', SET_DEFAULTS));
  assert.equal(rows.length, 6);
  const parsed = U.parseGlobal(U.rowsFromCells(rows.slice(1)), ['r']);
  assert.deepEqual(plain(parsed.errors), []);
  assert.equal(parsed.setRows.length, 1);
  assert.ok(U.isEpochRow(parsed.setRows[0]));
  assert.deepEqual(plain(U.holidaysTemplateRows(dt('2026-10-07T12:00'))), [['date', 'note'], ['2025-01-01', 'New Year']]);
  assert.deepEqual(plain(U.holidaysTemplateRows(dt('0100-02-03'))), [['date', 'note'], ['0099-01-01', 'New Year']]);
});

test('gridRows: extension after the last claim, backfill before the first row', () => {
  const cells = [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob'), R('', '2026-10-12T09:00', 'shift', 'alice')];
  const out = U.gridRows(U.rowsFromCells(cells), 2, 3, timelineOf(cells));
  assert.deepEqual(shifts(out), [
    ['2026-09-21T09:00', 'shift', ''],
    ['2026-09-28T09:00', 'shift', ''],
    ['2026-10-05T09:00', 'set', 'period=1w, horizon=4w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'],
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
    ['2026-10-05T09:00', 'set', 'period=1w, horizon=4w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0'],
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

test('fillShiftsGridCells: template rows, blank rows, start-only rows typed, original cells kept', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob'), R('x', '2026-10-12T09:00', '', '')];
  const selected = [R('', '', 'shift', ''), tab[2], R('', '2026-10-19 09:00', 'SHIFT', 'bob', '', '', 'keep me'), R('', '', '', ''), R('', '', 'SHIFT', '')];
  const out = plain(U.fillShiftsGridCells(selected, tab, ['2026-12-25', null]));
  assert.deepEqual(out.rows, [
    R('', '2026-10-05T09:00', 'shift', ''),
    R('x', '2026-10-12T09:00', 'shift', ''),
    R('', '2026-10-19 09:00', 'shift', 'bob', '', '', 'keep me'),
    R('', '2026-10-26T09:00', 'shift', ''),
    R('', '2026-11-02T09:00', 'shift', ''),
  ]);
});

test('fillShiftsGridCells: dated comments stay, undated comments travel with the next dated row', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob')];
  const selected = [
    R('', '', '', ''),
    R('', '', '', 'above the first shift'),
    R('', '2026-10-12T09:00', 'shift', 'alice'),
    R('', '2026-10-14T09:00', '', 'mid-week note'),
    R('', '', '', '', '', '', 'above bob'),
    R('', '2026-10-26T09:00', 'shift', 'bob'),
    R('', '', '', ''),
    R('', '', '', 'trailing'),
  ];
  const out = plain(U.fillShiftsGridCells(selected, tab, []));
  assert.deepEqual(out.rows, [
    R('', '2026-10-05T09:00', 'shift', ''),
    R('', '', '', 'above the first shift'),
    R('', '2026-10-12T09:00', 'shift', 'alice'),
    R('', '2026-10-14T09:00', '', 'mid-week note'),
    R('', '2026-10-19T09:00', 'shift', ''),
    R('', '', '', '', '', '', 'above bob'),
    R('', '2026-10-26T09:00', 'shift', 'bob'),
    R('', '2026-11-02T09:00', 'shift', ''),
    R('', '', '', 'trailing'),
  ]);
});

test('fillShiftsGridCells: epoch rows at the top stay in place; gaps after the anchor row are filled', () => {
  const tab = [R('', '', 'set', 'period=1w, horizon=4w'), R('', '', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'set', 'anchor')];
  const selected = [
    R('', '', '', 'help text'),
    tab[0], tab[1], tab[2],
    R('', '', '', ''),
    R('', '2026-10-12T09:00', 'shift', 'alice'),
    R('', '', '', ''),
  ];
  const out = plain(U.fillShiftsGridCells(selected, tab, []));
  assert.equal(out.error, undefined);
  assert.deepEqual(out.rows.map((r) => [r[1], r[2], r[3]]), [
    ['', '', 'help text'],
    ['', 'set', 'period=1w, horizon=4w'],
    ['', 'team', 'alice, bob'],
    ['2026-10-05T09:00', 'set', 'anchor'],
    ['2026-10-05T09:00', 'shift', ''],
    ['2026-10-12T09:00', 'shift', 'alice'],
    ['2026-10-19T09:00', 'shift', ''],
  ]);
  // A blank row above the anchor row would become a shift before the anchor, which is refused.
  const before = plain(U.fillShiftsGridCells([R('', '', '', ''), tab[0], tab[1], tab[2], R('', '2026-10-12T09:00', 'shift', 'alice')], tab, []));
  assert.equal(before.error, '1 empty row(s) above would fall before the first set row');
});

test('fillShiftsGridCells: refusals', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice')];
  assert.equal(plain(U.fillShiftsGridCells([R('', '', 'shift', 'alice'), tab[1]], tab, [])).error, 'selected row 1 has content but no start');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', 'join', 'x'), tab[1]], tab, [])).error, 'selected row 1 has content but no start');
  assert.equal(plain(U.fillShiftsGridCells([tab[1], R('', 'soon', 'shift', '')], tab, [])).error, 'selected row 2: bad start "soon"');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '', '', '')], tab, [])).error, 'the selection has no dated row to start from');
  assert.match(plain(U.fillShiftsGridCells([tab[1]], [tab[1]], [])).error, /dated set row with a period and an anchor/);
  const epochOnly = [R('', '', 'set', 'period=1w'), tab[1]];
  assert.match(plain(U.fillShiftsGridCells([tab[1]], epochOnly, [])).error, /dated set row with a period and an anchor/);
  assert.equal(plain(U.fillShiftsGridCells([R('', '2026-09-28T09:00', 'shift', '')], tab, [])).error, 'selected row 1 is dated before the first set row');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '', '', ''), R('', '2026-10-12T09:00', 'shift', 'alice')], tab, [])).error, '2 empty row(s) above would fall before the first set row');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '2026-10-12T09:00', 'shift', 'alice')], tab, [])).rows.length, 2);
});

test('fillShiftsGridCells: counted grid runs through skipped days using holidays', () => {
  const tab = [R('', '2026-10-05T09:00', 'set', 'period=1d, grid=counted, skip_weekends=true, skip_holidays=true, horizon=90d, tolerance=0, min_distance=0, autopin=a:0'), R('', '2026-10-05T09:00', 'team', 'alice')];
  const selected = [R('', '2026-10-08T09:00', 'shift', 'alice'), R('', '', '', ''), R('', '', '', ''), R('', '', '', '')];
  const out = plain(U.fillShiftsGridCells(selected, tab, ['2026-10-09']));
  assert.deepEqual(out.rows.map((r) => r[1]), ['2026-10-08T09:00', '2026-10-12T09:00', '2026-10-13T09:00', '2026-10-14T09:00']);
});
