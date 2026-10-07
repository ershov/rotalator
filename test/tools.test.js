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

const SET_DEFAULTS = 'period=1w, grid=calendar, horizon=30w, skip_weekends=true, skip_holidays=true, tolerance=0.5sl, min_distance=0.5ts, tiebreak=order, seed=0, precredit=1ts, autopin=a:2sl';

test('templateRows: header, help comments, epoch set and team rows, dated set anchor', () => {
  const rows = plain(U.templateRows(dt('2026-10-05T09:00')));
  assert.deepEqual(rows[0], plain(U.LEDGER_HEADER));
  assert.deepEqual(rows.slice(1, 9).map((r) => r[6]), [
    'ROWS:',
    'shift: one member, or nobody',
    'team / score: name, name=number, name+=n, name-=n [, ...]; a bare name scores the roster minimum (a newcomer in team, anyone in score)',
    'join: name, name=number [, ...]; a bare name joins at the roster minimum',
    'leave: name [, name ...]',
    'exclude / include: name [, name ...]',
    'set: key, key=value',
    'set / team without start: take the date of the nearest dated row above, or apply from the beginning at the top; the dated set anchor row fixes where shifts start',
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
  // anchor comes from the dated row; cal and slack have an empty default and are not spelled.
  const expected = { ...plain(U.defaultSettings()), period: 7 * 1440 };
  delete expected.anchor;
  delete expected.cal;
  delete expected.slack;
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
  for (const word of ['comment', 'sl:', 'ts:', 'Run - preview', 'Set Up Spreadsheet', 'Set Up Tab', 'Fill Shifts Grid', 'Install nightly trigger', 'MANUAL.md', 'INSTALL.md']) assert.ok(text.includes(word), word);
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
  assert.deepEqual(rows.slice(1, 5).map((r) => r[6]), ['ROWS:', 'repel / repel! / attract / attract! / detach: Rotation1, Rotation2', 'set: key, key=value', 'set / repel / repel! / attract / attract! without start: take the date of the nearest dated row above, or apply from the beginning at the top']);
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
  // A blank row above the anchor row would become a shift before the grid start, which is refused.
  const before = plain(U.fillShiftsGridCells([R('', '', '', ''), tab[0], tab[1], tab[2], R('', '2026-10-12T09:00', 'shift', 'alice')], tab, []));
  assert.equal(before.error, '1 empty row(s) above would fall before the grid start 2026-10-05T09:00');
});

test('scoresAtCursorRow: roster and scores just before the instant as a #team comment; rows at the instant do not count', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'shift', 'alice'), R('', '2026-10-12T09:00', 'shift', 'bob'),
    R('', '2026-10-19T09:00', 'join', 'carol'), R('', '2026-10-19T09:00', 'shift', 'alice'), R('', '2026-10-26T09:00', 'shift', 'carol')];
  const at = (s) => plain(U.scoresAtCursorRow(tab, dt(s), [], []));
  assert.deepEqual(at('2026-10-19T09:00'), { row: ['', '2026-10-19T09:00', '#team', 'alice=7, bob=7', '', '', ''] }, 'the join and the shift at the instant are not counted');
  assert.deepEqual(at('2026-10-12T09:00').row[3], 'alice=7, bob=0');
  assert.deepEqual(at('2026-10-15T09:00').row[3], 'alice=7, bob=3', 'a shift in progress is credited up to the instant');
  assert.deepEqual(at('2026-10-26T09:00').row[3], 'alice=14, bob=7, carol=7', 'carol joined at the roster minimum');
  assert.deepEqual(at('2026-10-05T09:00').row[3], '', 'nothing before the first row');
  // The comment sorts first at its instant, so a run keeps it above the rows it describes.
  const sorted = U.sortRows(U.rowsFromCells([tab[4], at('2026-10-19T09:00').row, tab[5]]));
  assert.deepEqual(plain(sorted.map((r) => r.type)), ['comment', 'join', 'shift']);
  assert.equal(plain(U.scoresAtCursorRow(tab.concat([R('', '2026-10-13T09:00', 'leave', 'zed')]), dt('2026-10-19T09:00'), [], [])).error, 'row 9: leave: unknown member "zed"');
  assert.match(plain(U.scoresAtCursorRow([R('', '2026-10-05T09:00', 'team', 'alice')], dt('2026-10-19T09:00'), [], [])).error, /no grid yet/);
});

test('fillShiftsGridCells: refusals', () => {
  const tab = [SET, R('', '2026-10-05T09:00', 'team', 'alice')];
  assert.equal(plain(U.fillShiftsGridCells([R('', '', 'shift', 'alice'), tab[1]], tab, [])).error, 'selected row 1 has content but no start');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', 'join', 'x'), tab[1]], tab, [])).error, 'selected row 1 has content but no start');
  assert.equal(plain(U.fillShiftsGridCells([tab[1], R('', 'soon', 'shift', '')], tab, [])).error, 'selected row 2: bad start "soon"');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '', '', '')], tab, [])).error, 'the selection has no dated row to start from');
  assert.match(plain(U.fillShiftsGridCells([tab[1]], [tab[1]], [])).error, /needs a period in a set row and an anchor/);
  const epochOnly = [R('', '', 'set', 'period=1w'), tab[1]];
  assert.match(plain(U.fillShiftsGridCells([tab[1]], epochOnly, [])).error, /needs a period in a set row and an anchor/);
  // A shift in the tab implies the anchor: the grid starts there and the selection fills on it.
  const impliedTab = epochOnly.concat([R('', '2026-10-12T09:00', 'shift', 'alice')]);
  assert.deepEqual(plain(U.fillShiftsGridCells([impliedTab[2], R('', '', '', '')], impliedTab, [])).rows.map((r) => [r[1], r[2]]), [['2026-10-12T09:00', 'shift'], ['2026-10-19T09:00', 'shift']]);
  assert.equal(plain(U.fillShiftsGridCells([tab[1], impliedTab[2]], impliedTab, [])).error, 'selected row 1 is dated before the grid start 2026-10-12T09:00');
  assert.equal(plain(U.fillShiftsGridCells([R('', '2026-09-28T09:00', 'shift', '')], tab, [])).error, 'selected row 1 is dated before the grid start 2026-10-05T09:00');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '', '', ''), R('', '2026-10-12T09:00', 'shift', 'alice')], tab, [])).error, '2 empty row(s) above would fall before the grid start 2026-10-05T09:00');
  assert.equal(plain(U.fillShiftsGridCells([R('', '', '', ''), R('', '2026-10-12T09:00', 'shift', 'alice')], tab, [])).rows.length, 2);
});

test('fillShiftsGridCells: counted grid runs through skipped days using holidays', () => {
  const tab = [R('', '2026-10-05T09:00', 'set', 'period=1d, grid=counted, skip_weekends=true, skip_holidays=true, horizon=90d, tolerance=0, min_distance=0, autopin=a:0'), R('', '2026-10-05T09:00', 'team', 'alice')];
  const selected = [R('', '2026-10-08T09:00', 'shift', 'alice'), R('', '', '', ''), R('', '', '', ''), R('', '', '', '')];
  const out = plain(U.fillShiftsGridCells(selected, tab, ['2026-10-09']));
  assert.deepEqual(out.rows.map((r) => r[1]), ['2026-10-08T09:00', '2026-10-12T09:00', '2026-10-13T09:00', '2026-10-14T09:00']);
});

test('fillShiftsGridCells: an undated set or team row takes the date of the row above, inside or above the selection', () => {
  const tab = [
    R('', '', 'set', 'period=1w, horizon=4w'), R('', '', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'set', 'anchor'),
    R('', '2026-10-05T09:00', 'shift', 'alice'), R('', '', '', 'a comment'), R('', '2026-10-12T09:00', 'error', 'old'),
    R('', '', 'team', 'alice, bob, carol'), R('', '2026-10-12T09:00', 'shift', 'bob'), R('', '', 'set', 'tolerance=1'),
  ];
  // Selection from the undated team row on: the row above the selection (the 5 Oct shift, past the comment and
  // the error row) gives its date; the set row under the 12 Oct shift takes that shift's date.
  // The dated team row opens the region at 5 Oct, so the gap before the 12 Oct shift gets an empty shift row.
  const out = plain(U.fillShiftsGridCells(tab.slice(6), tab, [], [], 6));
  assert.deepEqual(out.rows.map((r) => [r[1], r[2], r[3]]), [
    ['2026-10-05T09:00', 'team', 'alice, bob, carol'],
    ['2026-10-05T09:00', 'shift', ''],
    ['2026-10-12T09:00', 'set', 'tolerance=1'],
    ['2026-10-12T09:00', 'shift', 'bob'],
  ]);
  // Without a topIndex (or nothing dated above) the leading undated row stays in front, undated.
  const front = plain(U.fillShiftsGridCells(tab.slice(6), tab, []));
  assert.deepEqual(front.rows.map((r) => [r[1], r[2]]), [['', 'team'], ['2026-10-12T09:00', 'set'], ['2026-10-12T09:00', 'shift']]);
  assert.deepEqual(plain(U.fillShiftsGridCells(tab.slice(0, 3), tab, [], [], 0)).rows.map((r) => r[1]), ['', '', '2026-10-05T09:00']);
});
