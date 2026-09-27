// GCal extension: menu actions, Set Up and #Help lines (DESIGN 13.5). Apps Script entry points; they use the
// core's SheetsStorage, runStorage, currentRotation and toast.
var GCAL_TOAST_TITLE = 'Rotalator calendar';
var GCAL_COLUMN_WIDTHS = [140, 120, 700];
var GCAL_TEMPLATE_PRESET = 'preset-1';
var GCAL_TEMPLATE_NOTE = 'First Google Calendar preset';
var GCAL_TEMPLATE_ID = 'FILL IN WITH CALENDAR ID';

// Cheat sheet shared by the #GCal template (comment rows in column C) and #Help: one line per setting with
// its values and default, the template variables, and how a rotation names presets.
var GCAL_CHEAT_SHEET = [
  'SETTINGS (one per row under a preset row: setting in B, value in C):',
  'id: calendar id, required (xxx@group.calendar.google.com, an address, primary)',
  'title: event title template, default ' + GCAL_DEFAULT_TITLE,
  'body: event description template, default ' + GCAL_DEFAULT_BODY,
  'allday: auto | true | false, default auto (all-day when the shift starts and ends at midnight)',
  'color: default (the calendar\'s own colour) | pale blue | pale green | mauve | pale red | yellow | orange | cyan | gray | blue | green | red | 1-11 | #RRGGBB (nearest), default default',
  'free: true | false, default true (the time shows as free)',
  'invite: true | false, default true (the assignee is invited when the id contains @)',
  'reminders: intervals before the start, 1d, 1h; default empty (the calendar defaults)',
  'TEMPLATES: {who} {rotation} {note} {pin} {start} {end}; {start:%a %e %b} with %Y %m %d %e %H %M %a %A %b %B %j %u',
  'USE: set cal=<preset> [<preset> ...] in a rotation or in #Global, then Run',
];

var GCAL_HELP_LINES = [
  '',
  'CALENDAR (GCal extension, #GCal tab: preset | setting | value):',
  'preset row: name in A (letters, digits, - _), note in C; setting rows below it: setting in B, value in C',
].concat(GCAL_CHEAT_SHEET.slice(1), [
  'export: after each run, one event per shift and preset from the stored snapshot to the horizon; tagged rotalator=<rotation>|<start>; untagged events never touched; nobody shifts skipped',
  'Re-export calendar [: current rotation]: every shift from the first one (repairs a cleaned or edited calendar)',
  'Clean calendar: current rotation | selected preset: delete the events Rotalator created for the rotation, or every Rotalator event of the preset\'s calendar',
]);

// Header, cheat sheet as comment rows, an empty row, then a first preset to fill in (reminders empty:
// calendar defaults; color default: the calendar's own colour).
function gcalTemplateRows() {
  var comment = function (text) { return ['', '', text]; };
  var setting = function (key, value) { return ['', key, value]; };
  return [GCAL_HEADER.slice()].concat(GCAL_CHEAT_SHEET.map(comment), [
    ['', '', ''],
    [GCAL_TEMPLATE_PRESET, '', GCAL_TEMPLATE_NOTE],
    setting('id', GCAL_TEMPLATE_ID),
    setting('title', GCAL_DEFAULT_TITLE),
    setting('body', GCAL_DEFAULT_BODY),
    setting('allday', 'auto'),
    setting('color', GCAL_COLOR_DEFAULT),
    setting('free', 'true'),
    setting('invite', 'true'),
    setting('reminders', ''),
  ]);
}

// Conditional row colours like the ledgers' (DESIGN 10.1): error rows light red, preset rows light blue like
// set rows, comment rows light yellow; the header row is excluded. Built here because the palette constants
// belong to the core's Apps Script file.
function gcalFormatRules() {
  return [
    { formula: '=$B1="' + GCAL_ERROR_TYPE + '"', color: COLOR_ERROR },
    { formula: '=AND($A1<>"", ROW()>1)', color: COLOR_SETTINGS },
    { formula: '=AND($A1="", $B1="", $C1<>"")', color: COLOR_COMMENT },
  ];
}

function gcal_menu(menu) {
  menu.addSeparator()
    .addItem('Re-export calendar', 'gcalReexport')
    .addItem('Re-export calendar: current rotation', 'gcalReexportCurrent')
    .addItem('Clean calendar: current rotation', 'gcalCleanCurrent')
    .addItem('Clean calendar: selected preset', 'gcalCleanPreset');
}

function gcal_help(lines) {
  return GCAL_HELP_LINES.slice();
}

// Formats #GCal like an editable system tab: script font, wrapped and top-left aligned everywhere, plain
// text, bold grey frozen header, widths, spare columns removed, grey tab colour.
function gcalFormatTab(sheet) {
  var width = GCAL_HEADER.length;
  var all = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  all.setFontFamily(FONT_FAMILY);
  all.setWrap(true);
  alignTopLeft(all);
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(COLOR_HEADER);
  sheet.setFrozenRows(1);
  GCAL_COLUMN_WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  trimColumns(sheet, width);
  setConditionalRules(sheet, gcalFormatRules(), width);
  sheet.setTabColor(TAB_COLOR_EDITABLE);
}

// #GCal directly after #Global: created there, or moved there once when it sits elsewhere. A tab moving from
// before #Global lands at #Global's current index, since #Global shifts up by one when it leaves.
function gcalPlaceTab(ss, sheet) {
  var global = ss.getSheetByName(GLOBAL_TAB);
  if (!global || sheet.getIndex() === global.getIndex() + 1) return;
  moveTab(ss, sheet, sheet.getIndex() < global.getIndex() ? global.getIndex() : global.getIndex() + 1);
}

// Hook: creates #GCal after #Global with the template when missing or empty, places and formats it.
function gcal_setup(ss) {
  var sheet = ss.getSheetByName(GCAL_TAB);
  if (!sheet) {
    var global = ss.getSheetByName(GLOBAL_TAB);
    sheet = ss.insertSheet(GCAL_TAB, global ? global.getIndex() : ss.getNumSheets());
  }
  if (isEmptySheet(sheet)) writeTextCells(sheet, 1, gcalTemplateRows());
  gcalPlaceTab(ss, sheet);
  gcalFormatTab(sheet);
  return sheet;
}

// Hook: Set Up Tab on #GCal fills an empty tab from the template; any other tab is left to the core.
function gcal_setupTab(sheet) {
  if (sheet.getName() !== GCAL_TAB) return false;
  if (!isEmptySheet(sheet)) { toast('"' + GCAL_TAB + '" is not empty; Set Up Tab only fills empty tabs', GCAL_TOAST_TITLE); return true; }
  writeTextCells(sheet, 1, gcalTemplateRows());
  gcalFormatTab(sheet);
  toast('"' + GCAL_TAB + '" set up from the template; fill in the calendar id of ' + GCAL_TEMPLATE_PRESET, GCAL_TOAST_TITLE);
  return true;
}

function gcalSummary(data) {
  var totals = {};
  GCAL_COUNTS.forEach(function (c) { totals[c] = data.lines.reduce(function (n, l) { return n + l[c]; }, 0); });
  var text = GCAL_COUNTS.map(function (c) { return c + ' ' + totals[c]; }).join(', ');
  if (data.elapsed !== undefined) text += ' in ' + data.elapsed + ' s';
  if (data.note) text += '; ' + data.note;
  return text + '; ' + finishedText(data.errors.length, data.note ? 1 : 0);
}

// Runs the scheduler without writing (the ledgers stay as they are) to get the plan inputs.
function gcalRunForExport(storage, rotations) {
  var options = { write: false, export: false };
  if (rotations) options.rotations = rotations;
  var result = runStorage(storage, storage.nowText, options);
  if (result.errors.length) toast(result.errors.length + ' error(s), nothing exported: ' + result.errors[0], GCAL_TOAST_TITLE);
  return result.errors.length ? null : result;
}

// Re-export: every shift from the first one, so a cleaned or hand-edited calendar is repaired.
function gcalExportWith(rotations) {
  var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
  var result = gcalRunForExport(storage, rotations);
  if (!result) return null;
  var plan = gcalPlan(result, result.ext.gcal, { repair: true, rotations: rotations || undefined });
  if (plan.events.length) gcalAnnounce(plan);
  var data = gcalReconcile(plan, gcalStatusData(plan), { tz: storage.tz, dry: false, progress: gcalProgress });
  gcalWriteCalendarErrors(storage, result.ext.gcal, data);
  data.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(gcalSummary(data), GCAL_TOAST_TITLE);
  return data;
}

// The menu actions run under the core's script lock (DESIGN 10.4), like Run.
function gcalReexport() {
  return withLock(function () { return gcalExportWith(null); });
}

function gcalReexportCurrent() {
  var name = currentRotation();
  return name === null ? null : withLock(function () { return gcalExportWith([name]); });
}

function gcalCleanNote(out) {
  return (out.note ? '; ' + out.note : '') + '; ' + finishedText(out.errors.length, out.note ? 1 : 0);
}

function gcalCleanCurrent() {
  var name = currentRotation();
  if (name === null) return null;
  return withLock(function () {
    var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
    var result = gcalRunForExport(storage, null);
    if (!result) return null;
    var clean = gcalCleanPlan(result, result.ext.gcal, { rotation: name });
    var out = gcalClean(clean, { tz: storage.tz });
    clean.errors.concat(out.errors).forEach(function (e) { console.log(e.where + ': ' + e.message); });
    toast(out.deleted + ' event(s) of ' + name + ' deleted in ' + clean.calendars.length + ' calendar(s) in ' + out.elapsed + ' s' + gcalCleanNote(out), GCAL_TOAST_TITLE);
    return out;
  });
}

// The active cell's row in #GCal names the preset; a setting row counts for the preset above it.
function gcalSelectedPreset(sheet) {
  if (sheet.getName() !== GCAL_TAB) return null;
  var row = sheet.getActiveRange().getRow();
  var names = sheet.getRange(1, 1, Math.max(row, 1), 1).getValues();
  while (row > 1 && cellText(names[row - 1][0]) === '') row--;
  return row > 1 ? cellText(names[row - 1][0]) : null;
}

// Deletes every Rotalator event of the selected preset's calendar within a wide window around now.
function gcalCleanPreset() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = gcalSelectedPreset(ss.getActiveSheet());
  if (name === null) { toast('select a preset row in ' + GCAL_TAB, GCAL_TOAST_TITLE); return null; }
  return withLock(function () {
    var storage = new SheetsStorage(ss);
    var clean = gcalCleanPlan(null, gcal_readInputs(storage), { preset: name });
    if (clean.error) { toast(clean.error, GCAL_TOAST_TITLE); return null; }
    var window = gcalCleanWindow(parseDateTime(storage.nowText));
    var out = gcalClean(clean, { tz: storage.tz, from: window.from, to: window.to });
    out.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
    toast(out.deleted + ' Rotalator event(s) deleted in ' + clean.calendar + ' between ' + window.from + ' and ' + window.to + ' in ' + out.elapsed + ' s' + gcalCleanNote(out), GCAL_TOAST_TITLE);
    return out;
  });
}
