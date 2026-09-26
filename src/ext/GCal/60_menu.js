// GCal extension: menu actions, Set Up and #Help lines (DESIGN 13.5). Apps Script entry points; they use the
// core's SheetsStorage, runStorage, currentRotation and toast.
var GCAL_TOAST_TITLE = 'Rotalator calendar';
var GCAL_COLUMN_WIDTHS = [120, 120, 640];

// Comment rows (A and B empty) written into a new #GCal tab.
var GCAL_TEMPLATE_HELP = [
  'PRESETS: a row with a name in column A starts a preset (C: a note); each row below it with an empty A sets one setting: B the key, C the value',
  'SETTINGS: id (calendar id, required), title, body, allday (auto | true | false), color (a Calendar colour name or 1 to 11), free (true | false), invite (true | false), reminders (1d, 1h)',
  'EXAMPLE: team | | Shared team calendar   then   | id | team@group.calendar.google.com   then   | color | pale blue   then   | reminders | 1d, 1h',
  'USE: set cal=team (space-separated preset names) in a rotation or in #Global, then Run; share each calendar with write access to the account that runs',
];

var GCAL_HELP_LINES = [
  '',
  'CALENDAR (GCal extension):',
  'cal=team personal: presets of the #GCal tab whose calendars receive the rotation\'s shifts after each run, one event per shift and preset, from the stored snapshot to the horizon',
  '#GCal rows: a name in column A starts a preset (C: note); the rows below with an empty A set id (required), title, body, allday (auto | true | false), color, free, invite, reminders',
  'templates: {who} {rotation} {note} {pin} {start} {end}; dates take a format, {start:%a %e %b} (%Y %m %d %e %H %M %a %A %b %B %j %u)',
  'Re-export calendar / Re-export calendar: current rotation: export every shift from the first one, repairing a calendar that was cleaned or edited',
  'Clean calendar: current rotation / Clean calendar: selected preset: delete the events Rotalator created for the rotation, or every Rotalator event of the preset\'s calendar',
  'events carry the tag rotalator=<rotation>|<start>; events without it are never touched; a shift with nobody gets no event',
];

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

// Creates #GCal with its header and help rows when missing or empty, then formats it like an editable tab:
// script font, plain text, bold grey frozen header, widths, spare columns removed, grey tab colour.
function gcal_setup(ss) {
  var sheet = ss.getSheetByName(GCAL_TAB) || ss.insertSheet(GCAL_TAB);
  if (isEmptySheet(sheet)) {
    writeTextCells(sheet, 1, [GCAL_HEADER.slice()].concat(GCAL_TEMPLATE_HELP.map(function (text) { return ['', '', text]; })));
  }
  var width = GCAL_HEADER.length;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily(FONT_FAMILY);
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(COLOR_HEADER);
  sheet.setFrozenRows(1);
  GCAL_COLUMN_WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  trimColumns(sheet, width);
  sheet.setTabColor(TAB_COLOR_EDITABLE);
  return sheet;
}

function gcalSummary(data) {
  var totals = {};
  GCAL_COUNTS.forEach(function (c) { totals[c] = data.lines.reduce(function (n, l) { return n + l[c]; }, 0); });
  var text = GCAL_COUNTS.map(function (c) { return c + ' ' + totals[c]; }).join(', ');
  return text + (data.errors.length ? '; ' + data.errors.length + ' error(s): ' + data.errors[0].message : '');
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
  var data = gcalReconcile(plan, gcalStatusData(plan), { tz: storage.tz, dry: false });
  data.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(gcalSummary(data), GCAL_TOAST_TITLE);
  return data;
}

function gcalReexport() {
  return gcalExportWith(null);
}

function gcalReexportCurrent() {
  var name = currentRotation();
  return name === null ? null : gcalExportWith([name]);
}

function gcalCleanCurrent() {
  var name = currentRotation();
  if (name === null) return null;
  var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
  var result = gcalRunForExport(storage, null);
  if (!result) return null;
  var clean = gcalCleanPlan(result, result.ext.gcal, { rotation: name });
  var out = gcalClean(clean, { tz: storage.tz });
  clean.errors.concat(out.errors).forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(out.deleted + ' event(s) of ' + name + ' deleted in ' + clean.calendars.length + ' calendar(s)' + (out.errors.length ? '; ' + out.errors[0].message : ''), GCAL_TOAST_TITLE);
  return out;
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
  var storage = new SheetsStorage(ss);
  var clean = gcalCleanPlan(null, gcal_readInputs(storage), { preset: name });
  if (clean.error) { toast(clean.error, GCAL_TOAST_TITLE); return null; }
  var window = gcalCleanWindow(parseDateTime(storage.nowText));
  var out = gcalClean(clean, { tz: storage.tz, from: window.from, to: window.to });
  out.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(out.deleted + ' Rotalator event(s) deleted in ' + clean.calendar + ' between ' + window.from + ' and ' + window.to + (out.errors.length ? '; ' + out.errors[0].message : ''), GCAL_TOAST_TITLE);
  return out;
}
