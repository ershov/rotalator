// Row logic behind the Set up, Template and Fill Shifts Grid tools (DESIGN 10). Pure; adapters read and write cells.

var TEMPLATE_TEAM = 'alice, bob, carol';
var TEMPLATE_PERIOD = '1w';
var HOLIDAYS_HEADER = ['date', 'note'];

var COLUMN_NOTES = {
  pin: 'Any non-empty value pins the row: the script never modifies or deletes it. A ticked checkbox works too.',
  start: 'YYYY-MM-DDTHH:MM in the spreadsheet time zone. Mandatory. Keep the column as plain text.',
  type: 'shift, team, join, leave, exclude, include, score, set. The script writes snapshot and error rows.',
  what: 'Payload of the row: one member for shift; a list for team, join, leave, exclude, include, score; key=value settings for set.',
  end: 'YYYY-MM-DDTHH:MM. Optional. Not together with duration.',
  duration: '1w, 3d, 12h, 1d12h. Optional. Not together with end.',
  note: 'Free text. Kept on your rows; the script writes notes on generated rows.',
  date: 'YYYY-MM-DD, one holiday per row. Counted by rotations with skip_holidays=true.',
};

// Most recent Monday 00:00 at or before t.
function recentMonday(t) {
  var day = dayIndex(t);
  return dayStart(day - (weekdayOfDay(day) + 6) % 7);
}

// Whole days as Nd, otherwise the short chained form.
function templateDuration(min) {
  return min % MINUTES_PER_DAY === 0 ? min / MINUTES_PER_DAY + 'd' : formatDuration(min);
}

// Every setting spelled out at its default: period=1w, bare anchor, the rest key=default.
function templateSetWhat() {
  return Object.keys(SETTINGS).map(function (key) {
    if (key === 'period') return 'period=' + TEMPLATE_PERIOD;
    if (key === 'anchor') return 'anchor';
    var def = SETTINGS[key].def;
    return key + '=' + (key === 'horizon' ? templateDuration(def) : String(def));
  }).join(', ');
}

// In-tab help: undated comment rows (text in note) that attach to the set row below them and stay on top.
var ROTATION_HELP = [
  'ROWS:',
  'shift: one member, or nobody',
  'team / score: name, name=baseline, name=number, name+=n, name-=n [, ...]',
  'join: name, name=baseline, name=number [, ...]',
  'leave: name [, name ...]',
  'exclude / include: name [, name ...]',
  'set: key, key=value',
];
var GLOBAL_HELP = [
  'ROWS:',
  'repel / attract / detach: Rotation1, Rotation2',
  'set: key, key=value',
];
var HOLIDAYS_SAMPLE_NOTE = 'New Year';

function helpRows(lines) {
  return lines.map(function (text) { return ['', '', '', '', '', '', text]; });
}

// Header, help rows and a set row with every setting at its default, dated firstStart, for a new #Global tab.
function globalTemplateRows(firstStart) {
  return [LEDGER_HEADER.slice()].concat(helpRows(GLOBAL_HELP), [['', formatDateTime(firstStart), 'set', templateSetWhat(), '', '', '']]);
}

// Header plus one sample holiday: New Year of the calendar year before `now`.
function holidaysTemplateRows(now) {
  var year = Number(formatDateTime(now).slice(0, 4)) - 1;
  return [HOLIDAYS_HEADER.slice(), [String(year).padStart(4, '0') + '-01-01', HOLIDAYS_SAMPLE_NOTE]];
}

// Header, help rows, set and team cell rows of a new rotation tab, dated firstStart.
function templateRows(firstStart) {
  var start = formatDateTime(firstStart);
  return [LEDGER_HEADER.slice()].concat(helpRows(ROTATION_HELP), [
    ['', start, 'set', templateSetWhat(), '', '', ''],
    ['', start, 'team', TEMPLATE_TEAM, '', '', ''],
  ]);
}

function previousBoundary(grid, t) {
  var b = grid.floor(t);
  return b < t ? b : grid.step(b, -1);
}

function emptyShiftRow(start) {
  return makeRow({ type: 'shift', start: start });
}

// Grid at t, or the first grid of the timeline for instants before its first set row.
function gridFor(timeline, t) {
  return timeline.gridAt(t) || timeline.gridAt(timeline.entries[0].start);
}

// DESIGN 10: dated rows sorted; between the first row and the later of the last shift claim end and the last
// row start, every uncovered boundary and gap start gets an empty shift row; nPre boundaries before the first
// row and nPost rows from the tail on. rows: dated row objects at or after the timeline's first set row.
function gridRows(rows, nPre, nPost, timeline) {
  var sorted = sortRows(rows);
  var dated = sorted.filter(function (r) { return r.start !== null; });
  if (!dated.length) return sorted;
  var changes = timeline.gridChanges();
  var shifts = rowsOfType(sorted, 'shift');
  var claims = shifts.map(function (s, i) {
    return [s.start, claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes)];
  });
  var first = dated[0].start;
  var lastStart = dated[dated.length - 1].start;
  var claimsEnd = claims.length ? claims[claims.length - 1][1] : first;
  var regionEnd = Math.max(claimsEnd, lastStart);

  var out = [];
  var slots = [];
  uncoveredSpans(first, regionEnd, claims).forEach(function (span) { splitSlots(span[0], span[1], timeline, changes, slots); });
  slots.forEach(function (slot) { out.push(emptyShiftRow(slot.start)); });

  var t = first;
  for (var i = 0; i < nPre; i++) {
    t = previousBoundary(gridFor(timeline, t), t);
    out.push(emptyShiftRow(t));
  }
  // The tail starts at a mid-period claim end (a gap start) or at the boundary at or after the last row.
  t = Math.max(claimsEnd, timeline.gridAt(lastStart).ceil(lastStart));
  for (var j = 0; j < nPost; j++) {
    out.push(emptyShiftRow(t));
    t = timeline.gridAt(t).next(t);
  }
  // New rows go in front so undated comments keep attaching to the selected row below them.
  return sortRows(out.concat(sorted));
}

// An undated selection row counts as an empty grid position when it is blank or carries type=shift and
// nothing else; any other undated row is a comment that travels with the next dated row.
function isTemplateShiftRow(cells) {
  return cells.every(function (c, i) { return i === 2 ? cellText(c).toLowerCase() === 'shift' : cellText(c) === ''; });
}

// A dated row with nothing but its start (and pin) is a grid position, not a comment.
function hasOnlyStart(cells) {
  return cells.every(function (c, i) { return i === 0 || i === 1 || cellText(c) === ''; });
}

// Fill Shifts Grid over a selection. selectedCells: the ledger columns of the selected rows; tabCells: every
// row of the tab below the header, for the settings timeline; holidayTexts: #Holidays column A; globalCells:
// #Global rows below the header, for global set rows. Returns { rows: cell arrays } or { error: message }.
// Dated comments stay in place; undated comments attach to the next dated row, trailing ones stay at the end.
function fillShiftsGridCells(selectedCells, tabCells, holidayTexts, globalCells) {
  var holidays = new Set();
  (holidayTexts || []).forEach(function (text) { var day = parseDay(text ?? ''); if (day !== null) holidays.add(day); });
  var localSets = sortRows(rowsOfType(rowsFromCells(tabCells), 'set'));
  var globalSets = rowsOfType(rowsFromCells(globalCells || []), 'set');
  var timeline = new SettingsTimeline(localSets, holidays, globalSets);
  var firstStart = localSets.length ? localSets[0].start : null;
  if (firstStart === null || timeline.at(firstStart).get('period') === null) {
    return { error: 'the tab needs a set row with period before the grid can be filled' };
  }
  var dated = [];
  var comments = [];
  var pre = 0, post = 0;
  for (var i = 0; i < selectedCells.length; i++) {
    var cells = selectedCells[i];
    var startText = cellText(cells[1]);
    var row = rowFromArray(cells, i + 1);
    row.cells = cells.slice();
    if (startText === '') {
      if (isBlankRow(cells) || isTemplateShiftRow(cells)) { if (dated.length) post++; else pre++; continue; }
      if (row.type !== 'comment') return { error: 'selected row ' + (i + 1) + ' has content but no start' };
      comments.push(row);
      continue;
    }
    if (row.start === null) return { error: 'selected row ' + (i + 1) + ': bad start "' + startText + '"' };
    if (row.start < firstStart) return { error: 'selected row ' + (i + 1) + ' is dated before the first set row' };
    if (row.type === 'comment' && hasOnlyStart(cells)) row.type = 'shift';
    if (row.type !== 'comment') row.cells[2] = row.type;
    dated = dated.concat(comments, [row]);
    comments = [];
    post = 0;
  }
  if (!dated.length) return { error: 'the selection has no dated row to start from' };
  var out = gridRows(dated, pre, post, timeline).concat(comments);
  if (out[0].start < firstStart) return { error: pre + ' empty row(s) above would fall before the first set row' };
  return { rows: out.map(function (r) { return r.cells || rowToArray(r); }) };
}
