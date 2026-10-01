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
  duration: '1w, 3d, 12h, 1d12h, 0.5d, 2sl (shift lengths), 1ts (team size x shift length). Optional. Not together with end.',
  note: 'Free text, yours: the script never writes into it, and generated shifts have an empty note.',
  date: 'YYYY-MM-DD, one holiday per row. Counted by rotations with skip_holidays=true.',
};

// Most recent Monday 00:00 at or before t.
function recentMonday(t) {
  var day = dayIndex(t);
  return dayStart(day - (weekdayOfDay(day) + 6) % 7);
}

// Every setting spelled out at its default: period=1w, the rest key=default; anchor is left to the dated row
// and a key with an empty default (cal) has nothing to spell.
function templateSetWhat() {
  return Object.keys(SETTINGS).filter(function (key) { return key !== 'anchor' && SETTINGS[key].def !== ''; }).map(function (key) {
    if (key === 'period') return 'period=' + TEMPLATE_PERIOD;
    var def = SETTINGS[key].def;
    return key + '=' + (def !== null && typeof def === 'object' ? def.text : String(def));
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
  'set / team without start: take the date of the nearest dated row above, or apply from the beginning at the top; the dated set anchor row fixes where shifts start',
];
var GLOBAL_HELP = [
  'ROWS:',
  'repel / repel! / attract / detach: Rotation1, Rotation2',
  'set: key, key=value',
  'set / repel / repel! / attract without start: take the date of the nearest dated row above, or apply from the beginning at the top',
];
var HOLIDAYS_SAMPLE_NOTE = 'New Year';

// The #Help tab, one line per row (DESIGN 10.1). Written in full by Set Up Spreadsheet.
var HELP_TEXT = [
  'ROTALATOR',
  'Rotalator keeps on-call rotations topped up in this spreadsheet. You edit the rotation tabs; the script runs nightly or from the Rotalator menu, replays the history and rewrites the future so that on-call load stays fair. Unpinned shifts after the snapshot row belong to the script and are regenerated on every run.',
  '',
  'COLUMNS: pin | start | type | what | end | duration | note',
  'pin: any value pins the row; the script never modifies or deletes a pinned row',
  'start: YYYY-MM-DD or YYYY-MM-DDTHH:MM in the spreadsheet time zone; mandatory except on comments and on set, team, repel, repel! and attract rows that apply from the beginning',
  'type: one of the row types below; an empty type makes the row a comment',
  'what: the payload of the row, see ROWS',
  'end / duration: optional extent of a shift or exclude; at most one of the two',
  'note: free text, yours; the script never writes into it, and generated shifts have an empty note',
  '',
  'ROWS:',
  'shift: one member, or nobody (empty, - or none)',
  'team / score: name, name=baseline, name=number, name+=n, name-=n [, ...]',
  'join: name, name=baseline, name=number [, ...]',
  'leave: name [, name ...]',
  'exclude / include: name [, name ...]; exclude takes end or duration, otherwise it lasts until an include',
  'set: key, key=value',
  'undated set / team / repel / repel! / attract: take the date of the nearest dated row above them, or apply from the beginning of the timeline when nothing dated is above; anchor needs a dated set row',
  'undated row at the bottom of the tab: it takes the date of the last generated shift near the horizon, not today; type it under the current shift instead',
  'repel / repel! / attract / detach: Rotation1, Rotation2 (mutual in #Global; in a rotation tab one-sided, naming the other rotation)',
  'snapshot: written by the script at the start of the current shift with the roster and scores; delete it to replay the whole history',
  'error: written by the script above the row it describes; removed on the next run',
  'comment: any row with an empty type; kept in place, never replayed; an undated comment sticks to the row below it',
  '',
  'SETTINGS (set rows; a bare key drops the local value, falling back to #Global and then to the default):',
  'period=1w: regular shift length in clock units; required in the first set row of a rotation',
  'anchor: bare key, the row start becomes the grid anchor; every shift starts at anchor + k x period',
  'grid=calendar: or counted, a boundary every period of counted (not skipped) days',
  'horizon=20w: generate shifts up to this interval after the snapshot',
  'skip_weekends=true: Saturdays and Sundays credit nothing',
  'skip_holidays=true: dates listed in #Holidays credit nothing',
  'tolerance=0.5sl: days (or an interval) above the lowest score that still count as candidates',
  'min_distance=0.5ts: rest required on both sides of a shift, as an interval',
  'tiebreak=order: or shuffle (deterministic hash with seed)',
  'seed=0: integer mixed into the shuffle',
  'baseline=median: score given to a joiner: median, mean, min or max of the roster',
  'precredit=1ts: how far ahead pinned shifts are credited before turns are decided',
  'autopin=a:2sl: after each run, shifts starting up to now + this interval get the pin marker a (false: never; a:2w sets the marker); pinned shifts are kept, so this fixes the near future',
  'cal: space-separated names of calendar presets from the #GCal tab (cal=team backup); exported by the GCal extension, a warning in #Status when it is not installed',
  'slack: space-separated names of Slack presets from the #Slack tab (slack=team heads-up); posted by the Slack extension, a warning in #Status when it is not installed',
  '',
  'INTERVALS (duration, horizon, min_distance, precredit, tolerance):',
  'clock units w d h m; one token may be fractional (1.5w, 0.5d), integer tokens chain from large to small (1d12h)',
  'sl: one shift length, the period in force; ts: team size x shift length, one full cycle of the roster (0.5ts, 2sl)',
  '0 is the zero interval; with grid=counted intervals count counted days, so 2d is two working days',
  '',
  'RELATIONS between rotations (rows in #Global, or one-sided in a rotation tab):',
  'repel: nobody holds overlapping shifts in both rotations; repel!: also keeps a member off the other rotation for half the combined min_distance before and after their shift; attract: prefer the member already on call in the other rotation; detach: ends an earlier relation',
  '',
  'MENU:',
  'Run: regenerates every rotation and rewrites #Status and #All shifts; the nightly trigger runs this',
  'Run - preview: writes #Preview <rotation> tabs instead of the ledgers, plus #Status and #All shifts; #Global is read but not written',
  'Run for current rotation / Run for current rotation - preview: the same for the active tab only',
  'Abort run: asks the run in progress to stop its calendar export or clean at the next event; one run at a time holds the script lock, others wait 5 s and give up',
  'Set Up Spreadsheet: creates missing tabs, formats every tab and rewrites #Help; never changes your data',
  'Set Up Tab: fills an empty tab from its template (rotation, #Holidays or #Global)',
  'Fill Shifts Grid: puts the selected rows of a rotation tab on the grid, filling start',
  'Install nightly trigger / Remove trigger: schedule Run daily between 02:00 and 03:00, or stop it',
  '',
  'NEVER TOUCHED BY THE SCRIPT: pinned rows; rows before the stored snapshot; comments; header rows; tabs without the ledger header. Unpinned shifts after the snapshot are regenerated every run.',
  '',
  'ONE GRID STEP: a shift without end or duration ends at the earlier of the next shift start and the next grid boundary, so it counts as at most one period. Give hand-entered history that spans several periods a duration or an end.',
  '',
  'MORE: MANUAL.md (features and everyday tasks) and INSTALL.md (setup, deployment, troubleshooting) in the Rotalator repository.',
];

// The #Help lines: HELP_TEXT followed by the lines each installed extension returns from <prefix>_help(lines)
// (DESIGN 8, Extensions); a hook that throws or returns no array adds nothing.
function helpText() {
  var lines = HELP_TEXT.slice();
  callExtensionHooks('help', [HELP_TEXT.slice()]).forEach(function (r) {
    if (Array.isArray(r.value)) lines = lines.concat(r.value.map(String));
  });
  return lines;
}

// 0-based indexes of the help lines (HELP_TEXT by default) written bold: the first line and every heading, a
// line ending with ':'.
function helpHeadingRows(lines) {
  var out = [];
  (lines || HELP_TEXT).forEach(function (line, i) { if (i === 0 || /:$/.test(line)) out.push(i); });
  return out;
}

function helpRows(lines) {
  return lines.map(function (text) { return ['', '', '', '', '', '', text]; });
}

// Header, help rows and an undated (epoch) set row with every setting at its default for a new #Global tab.
function globalTemplateRows() {
  return [LEDGER_HEADER.slice()].concat(helpRows(GLOBAL_HELP), [['', '', 'set', templateSetWhat(), '', '', '']]);
}

// Header plus one sample holiday: New Year of the calendar year before `now`.
function holidaysTemplateRows(now) {
  var year = Number(formatDateTime(now).slice(0, 4)) - 1;
  return [HOLIDAYS_HEADER.slice(), [String(year).padStart(4, '0') + '-01-01', HOLIDAYS_SAMPLE_NOTE]];
}

// Header, help rows, an epoch set row with every default, an epoch team row and one dated set anchor row at
// firstStart, for a new rotation tab.
function templateRows(firstStart) {
  return [LEDGER_HEADER.slice()].concat(helpRows(ROTATION_HELP), [
    ['', '', 'set', templateSetWhat(), '', '', ''],
    ['', '', 'team', TEMPLATE_TEAM, '', '', ''],
    ['', formatDateTime(firstStart), 'set', 'anchor', '', '', ''],
  ]);
}

function previousBoundary(grid, t) {
  var b = grid.floor(t);
  return b < t ? b : grid.offset(b, -grid.period);
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
  var dated = sorted.filter(function (r) { return r.start !== null && isFinite(r.start); });
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
// nothing else; an undated comment travels with the next dated row; an undated set/team/relation row takes
// the date of the nearest dated selected row above it (3.4), or stays in front when there is none.
function isTemplateShiftRow(cells) {
  return cells.every(function (c, i) { return i === 2 ? cellText(c).toLowerCase() === 'shift' : cellText(c) === ''; });
}

// A dated row with nothing but its start (and pin) is a grid position, not a comment.
function hasOnlyStart(cells) {
  return cells.every(function (c, i) { return i === 0 || i === 1 || cellText(c) === ''; });
}

// Fill Shifts Grid over a selection. selectedCells: the ledger columns of the selected rows; tabCells: every
// row of the tab below the header, for the settings timeline; holidayTexts: #Holidays column A; globalCells:
// #Global rows below the header, for global set rows; topIndex: index in tabCells of the first selected row,
// so an undated set/team/relation row at the top of the selection takes its date from the tab rows above it,
// as the run would (3.4). Returns { rows: cell arrays } or { error: message }. Dated comments stay in place;
// undated comments attach to the next dated row, trailing ones stay at the end.
function fillShiftsGridCells(selectedCells, tabCells, holidayTexts, globalCells, topIndex) {
  var holidays = new Set();
  (holidayTexts || []).forEach(function (text) { var day = parseDay(text ?? ''); if (day !== null) holidays.add(day); });
  var localSets = sortRows(rowsOfType(rowsFromCells(tabCells), 'set'));
  var globalSets = rowsOfType(rowsFromCells(globalCells || []), 'set');
  var timeline = new SettingsTimeline(localSets, holidays, globalSets);
  var datedSets = localSets.filter(function (r) { return isFinite(r.start); });
  var firstStart = datedSets.length ? datedSets[0].start : null;
  if (firstStart === null || timeline.gridAt(firstStart) === null) {
    return { error: 'the tab needs a dated set row with a period and an anchor in force before the grid can be filled' };
  }
  var rows = [];
  var comments = [];
  var pre = 0, post = 0, datedCount = 0;
  var above = null;
  for (var k = (topIndex || 0) - 1; k >= 0 && above === null; k--) {
    var earlier = rowFromArray(tabCells[k], k + 2);
    if (earlier.type !== 'comment' && earlier.type !== 'error' && earlier.start !== null && isFinite(earlier.start)) above = earlier.start;
  }
  for (var i = 0; i < selectedCells.length; i++) {
    var cells = selectedCells[i];
    var startText = cellText(cells[1]);
    var row = rowFromArray(cells, i + 1);
    row.cells = cells.slice();
    if (startText === '') {
      if (isBlankRow(cells) || isTemplateShiftRow(cells)) { if (datedCount) post++; else pre++; continue; }
      if (row.type === 'comment') { comments.push(row); continue; }
      if (!isEpochRow(row)) return { error: 'selected row ' + (i + 1) + ' has content but no start' };
      if (above !== null) { row.start = above; row.cells[1] = formatDateTime(above); }
    } else {
      if (row.start === null) return { error: 'selected row ' + (i + 1) + ': bad start "' + startText + '"' };
      if (row.start < firstStart) return { error: 'selected row ' + (i + 1) + ' is dated before the first set row' };
      if (row.type === 'comment' && hasOnlyStart(cells)) row.type = 'shift';
      if (row.type !== 'comment') above = row.start;
      datedCount++;
      post = 0;
    }
    if (row.type !== 'comment') row.cells[2] = row.type;
    rows = rows.concat(comments, [row]);
    comments = [];
  }
  if (!datedCount) return { error: 'the selection has no dated row to start from' };
  var out = gridRows(rows, pre, post, timeline).concat(comments);
  var firstOut = out.find(function (r) { return r.start !== null && isFinite(r.start); });
  if (firstOut && firstOut.start < firstStart) return { error: pre + ' empty row(s) above would fall before the first set row' };
  return { rows: out.map(function (r) { return r.cells || rowToArray(r); }) };
}
