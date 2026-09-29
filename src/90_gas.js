// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';
var LOCK_WAIT_MS = 5000;
var RUN_BUDGET_SECONDS = 300;
var ABORT_PROPERTY = 'rotalator.abort';
var ABORT_CHECK_MS = 3000;
var LOCK_BUSY_MESSAGE = 'another Rotalator run is in progress';
var FONT_FAMILY = 'Roboto Mono';
var TAB_COLOR_GENERATED = '#4285f4';
var TAB_COLOR_EDITABLE = '#9e9e9e';
var TAB_COLOR_HELP = '#76a5af';
var HELP_COLUMN_WIDTH = 900;
var HELP_COLUMNS = 1;
var DEFAULT_ROTATION_TAB = 'Rotation 1 Primary';
var LEDGER_COLUMN_WIDTHS = { pin: 40, start: 150, type: 80, what: 320, end: 150, duration: 80, note: 640 };
var HOLIDAYS_COLUMN_WIDTHS = { date: 110, note: 640 };
var SHIFTS_MIN_COLUMN_WIDTH = 120;
// #Status: keys | names or dates | dates | gap | gap | member | mark | score | projected | last | next |
// exclusions | gap | gap | setting | value | source.
var STATUS_COLUMN_WIDTHS = [100, 150, 150, 60, 60, 120, 60, 100, 100, 150, 150, 150, 60, 60, 100, 150, 100];

// Pastel palette (DESIGN 10.1).
var COLOR_HEADER = '#eeeeee';
var COLOR_DIVIDER = '#d9ead3';
var COLOR_ERROR = '#f4c7c3';
var COLOR_WARNING = '#fce5cd';
var COLOR_SETTINGS = '#c9daf8';
var COLOR_ROSTER = '#d0e0e3';
var COLOR_SNAPSHOT = '#d9ead3';
var COLOR_COMMENT = '#fff2cc';
var COLOR_CURRENT_CELL = COLOR_COMMENT;
var COLOR_RELATION = '#d9ead3';
var COLOR_DETACH = '#efefef';

// Conditional formatting over A:G, keyed on the type cell; comment rows have content but no type.
var COMMENT_FORMULA = '=AND($C1="", COUNTA($A1:$G1)>0)';
var LEDGER_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="team", $C1="join", $C1="leave", $C1="include", $C1="exclude")', color: COLOR_ROSTER },
  { formula: '=$C1="snapshot"', color: COLOR_SNAPSHOT },
  { formula: '=OR($C1="attract", $C1="repel", $C1="repel!")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];
var GLOBAL_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="attract", $C1="repel", $C1="repel!")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];

// Storage interface of DESIGN 8 over the active spreadsheet. With preview set, ledgers are written to
// '#Preview <rotation>' tabs instead of the ledger tabs and #Global is not written at all. Ledgers are
// written as plain text only.
class SheetsStorage {
  constructor(spreadsheet, options) {
    this.ss = spreadsheet;
    this.tz = spreadsheet.getSpreadsheetTimeZone();
    this.preview = Boolean(options && options.preview);
    this.nowText = Utilities.formatDate(new Date(), this.tz, CELL_DATETIME_FORMAT);
    this.tabs = null;
  }

  isDateCell(cell) {
    return Object.prototype.toString.call(cell) === '[object Date]';
  }

  formatCell(cell, pattern) {
    return this.isDateCell(cell) ? Utilities.formatDate(cell, this.tz, pattern) : cell;
  }

  // Cell values with real Date cells converted to canonical text in the spreadsheet time zone.
  readValues(sheet, pattern) {
    var self = this;
    return sheet.getDataRange().getValues().map(function (row) {
      return row.map(function (cell) { return self.formatCell(cell, pattern); });
    });
  }

  // Rotations are the non-'#' tabs with the ledger header; only the ledger columns are read. Every other tab
  // except the known system tabs is reported as ignored, so a disabled '#<rotation>' shows up in #Status.
  scanTabs() {
    if (this.tabs) return this.tabs;
    var ledgers = {};
    var ignored = [];
    var self = this;
    this.ss.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (isSystemTab(name)) {
        if (!isKnownSystemTab(name)) ignored.push(name);
        return;
      }
      var header = headerCells(sheet);
      if (!isLedgerHeader(header)) { ignored.push(name); return; }
      ledgers[name] = self.readValues(sheet, CELL_DATETIME_FORMAT).slice(1)
        .map(function (row) { return row.slice(0, LEDGER_HEADER.length); });
    });
    this.tabs = { ledgers: ledgers, ignored: ignored };
    return this.tabs;
  }

  readLedgers() {
    return this.scanTabs().ledgers;
  }

  ignoredTabs() {
    return this.scanTabs().ignored.slice();
  }

  // Date texts per row after the header, null for blank rows so row numbers stay aligned.
  readHolidays() {
    var sheet = this.ss.getSheetByName(HOLIDAYS_TAB);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATE_FORMAT);
    var body = rows.length && cellText(rows[0][0]).toLowerCase() === 'date' ? rows.slice(1) : rows;
    return body.map(function (r) { return isBlankRow(r) ? null : cellText(r[0]); });
  }

  // The #Global tab must carry the ledger header; anything else is ignored.
  readGlobal() {
    var sheet = this.ss.getSheetByName(GLOBAL_TAB);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATETIME_FORMAT);
    return rows.length && isLedgerHeader(rows[0]) ? rows.slice(1).map(function (row) { return row.slice(0, LEDGER_HEADER.length); }) : [];
  }

  // Rows below the header of any tab, for extensions: [] when the tab is missing or its first row is not the
  // header (case-insensitive); only the header's columns are returned.
  readTabRows(name, header) {
    var sheet = this.ss.getSheetByName(name);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATETIME_FORMAT);
    var matches = rows.length && header.every(function (h, i) { return cellText(rows[0][i]).toLowerCase() === h; });
    return matches ? rows.slice(1).map(function (row) { return row.slice(0, header.length); }) : [];
  }

  // Rows below the header of any tab, written back in full, for extensions: the mirror of readTabRows. A
  // missing tab is created with the header as its first row; rows are cut or padded to the header width.
  writeTabRows(name, header, rows) {
    var sheet = this.ss.getSheetByName(name);
    if (!sheet) {
      sheet = this.ss.insertSheet(name);
      this.writeTextRows(sheet, 1, [header]);
      this.formatTableRows(sheet, header.length, { headerRows: [0] });
      sheet.setFrozenRows(1);
    }
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, header.length).clearContent();
    var cells = rows.map(function (row) { return header.map(function (_, i) { return row[i] === undefined || row[i] === null ? '' : row[i]; }); });
    this.writeTextRows(sheet, 2, cells);
  }

  sheetNamed(name) {
    return this.ss.getSheetByName(name) || this.ss.insertSheet(name);
  }

  // A missing preview tab is created right after the tab it previews; an existing one is never moved.
  previewSheet(name) {
    var sheet = this.ss.getSheetByName(previewTabName(name));
    if (sheet) return sheet;
    var base = this.ss.getSheetByName(name);
    return this.ss.insertSheet(previewTabName(name), base ? base.getIndex() : this.ss.getNumSheets());
  }

  writeTextRows(sheet, row, rows) {
    writeTextCells(sheet, row, rows);
  }

  // Bold grey header rows, a green divider, red error rows, orange warning rows and yellow current cells,
  // from the 0-based indexes the status module reports in table { headerRows, dividerRows, errorRows,
  // warningRows, currentCells }.
  formatTableRows(sheet, width, table) {
    var paint = function (indexes, color) {
      (indexes || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setBackground(color); });
    };
    (table.headerRows || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setFontWeight('bold'); });
    paint(table.headerRows, COLOR_HEADER);
    paint(table.dividerRows, COLOR_DIVIDER);
    paint(table.errorRows, COLOR_ERROR);
    paint(table.warningRows, COLOR_WARNING);
    (table.currentCells || []).forEach(function (c) { sheet.getRange(c.row + 1, c.col + 1).setBackground(COLOR_CURRENT_CELL); });
  }

  // Rows below the header of a ledger-shaped tab. A preview goes to '#Preview <name>', rewritten with a fresh
  // header and formatted like a rotation tab (formatTab, DESIGN 10.1), so Set Up and the writer agree.
  writeLedgerRows(name, rows) {
    var sheet;
    if (this.preview) {
      sheet = this.previewSheet(name);
      sheet.clear();
      this.writeTextRows(sheet, 1, [LEDGER_HEADER]);
    } else {
      sheet = this.ss.getSheetByName(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, LEDGER_HEADER.length).clearContent();
    }
    this.writeTextRows(sheet, 2, rows);
    if (this.preview) formatTab(sheet);
  }

  writeLedger(rotation, rows) {
    this.writeLedgerRows(rotation, rows);
  }

  // A preview reads #Global as usual and writes nothing for it.
  writeGlobal(rows) {
    if (!this.preview) this.writeLedgerRows(GLOBAL_TAB, rows);
  }

  // Generated tabs are cleared with their formats and rewritten; table: { rows, headerRows, dividerRows, currentCells }.
  writeTable(name, table) {
    var sheet = this.sheetNamed(name);
    sheet.clear();
    this.writeTextRows(sheet, 1, table.rows);
    if (table.rows.length) this.formatTableRows(sheet, table.rows[0].length, table);
  }

  // #Status and #All shifts tabs, rewritten in full from the status data (DESIGN 5.8).
  writeStatus(data) {
    this.writeTable(STATUS_TAB, statusRows(data));
    var shifts = shiftsRows(data);
    this.writeTable(ALL_SHIFTS_TAB, shifts);
    var sheet = this.ss.getSheetByName(ALL_SHIFTS_TAB);
    var width = shifts.rows[0].length;
    sheet.setFrozenRows(1);
    trimColumns(sheet, width);
    // Columns fit their content, never narrower than the minimum.
    sheet.autoResizeColumns(1, width);
    for (var c = 1; c <= width; c++) {
      if (sheet.getColumnWidth(c) < SHIFTS_MIN_COLUMN_WIDTH) sheet.setColumnWidth(c, SHIFTS_MIN_COLUMN_WIDTH);
    }
  }
}

// Core items first, then each installed extension adds its own (<prefix>_menu(menu)); a failing extension is
// logged and the menu is installed without its items.
function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu('Rotalator')
    .addItem('Run', 'run')
    .addItem('Run - preview', 'previewRun')
    .addItem('Run for current rotation', 'runCurrent')
    .addItem('Run for current rotation - preview', 'previewRunCurrent')
    .addItem('Abort run', 'abortRun')
    .addSeparator()
    .addItem('Set Up Spreadsheet', 'setupSpreadsheet')
    .addItem('Set Up Tab', 'setupTab')
    .addItem('Fill Shifts Grid', 'fillShiftsGrid')
    .addSeparator()
    .addItem('Install nightly trigger', 'installTrigger')
    .addItem('Remove trigger', 'removeTrigger');
  callExtensionHooks('menu', [menu], logExtensionError);
  menu.addToUi();
}

// On errors the ledgers are still written: rows unchanged plus error rows (DESIGN 6).
// rotations: names to regenerate, or null for all.
function runWith(preview, rotations) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss, { preview: preview });
  var options = { write: true, mode: preview ? 'preview' : 'run' };
  if (rotations) options.rotations = rotations;
  var result = runStorage(storage, storage.nowText, options);
  var title = preview ? 'Rotalator preview' : 'Rotalator';
  var what = rotations ? rotations.join(', ') : Object.keys(result.ledgers).length + ' rotation(s)';
  var done = result.status ? what + ' ' + (preview ? 'previewed' : 'updated') + ' at ' + storage.nowText : result.errors[0];
  var warnings = result.status ? result.status.warnings.length : 0;
  var message = done + '; ' + finishedText(result.errors.length, warnings);
  result.errors.forEach(function (e) { console.log(e); });
  ss.toast(message, title, 10);
  return result;
}

// One Rotalator run at a time (DESIGN 10.4): the script lock is shared by every user and the trigger. When
// it is not free within LOCK_WAIT_MS the action is skipped with a toast and a log line (the trigger has no
// UI) and nothing changes. Clears the abort flag, arms the run guard with the time budget and an abort check
// that reads the flag at most every ABORT_CHECK_MS, runs fn and always releases the lock. Extensions wrap
// their own menu actions with it.
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) { toast(LOCK_BUSY_MESSAGE); console.log(LOCK_BUSY_MESSAGE); return null; }
  try {
    PropertiesService.getScriptProperties().deleteProperty(ABORT_PROPERTY);
    activeRunGuard = runGuard({
      start: Date.now(), budgetSeconds: RUN_BUDGET_SECONDS, clock: Date.now,
      aborted: throttledFlag(abortRequested, ABORT_CHECK_MS, Date.now),
    });
    return fn();
  } finally {
    activeRunGuard = null;
    lock.releaseLock();
  }
}

// The abort flag is a script property, so a menu click reaches the run in progress.
function abortRequested() {
  return PropertiesService.getScriptProperties().getProperty(ABORT_PROPERTY) === '1';
}

// Menu: Abort run. When the lock is free no run is in progress and nothing is set (a stale flag would be
// discarded by the next run anyway); otherwise the flag is set and the run holding the lock stops at its next
// check.
function abortRun() {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(0)) { lock.releaseLock(); toast('no run in progress'); return false; }
  PropertiesService.getScriptProperties().setProperty(ABORT_PROPERTY, '1');
  toast('abort requested; the export or clean in progress stops at its next event');
  return true;
}

function run() {
  return withLock(function () { return runWith(false, null); });
}

function previewRun() {
  return withLock(function () { return runWith(true, null); });
}

// The active tab must be a rotation tab.
function currentRotation() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) || !isLedgerHeader(headerCells(sheet))) {
    toast('"' + name + '" is not a rotation tab');
    return null;
  }
  return name;
}

function runCurrent() {
  var name = currentRotation();
  return name === null ? null : withLock(function () { return runWith(false, [name]); });
}

function previewRunCurrent() {
  var name = currentRotation();
  return name === null ? null : withLock(function () { return runWith(true, [name]); });
}

function deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function installTrigger() {
  deleteTriggers();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyDays(1).atHour(2).inTimezone(ss.getSpreadsheetTimeZone()).create();
  ss.toast('Nightly run installed between 02:00 and 03:00 ' + ss.getSpreadsheetTimeZone(), 'Rotalator', 10);
}

function removeTrigger() {
  deleteTriggers();
  SpreadsheetApp.getActiveSpreadsheet().toast('Nightly run removed', 'Rotalator', 10);
}

function toast(message, title) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, title || 'Rotalator', 10);
}

function isEmptySheet(sheet) {
  return sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
}

// Every cell top-left aligned, so multi-line notes and wrapped help read from the top like the header.
function alignTopLeft(range) {
  range.setVerticalAlignment('top').setHorizontalAlignment('left');
}

// Writes rows as plain text in the script font, top-left aligned, from `row` down, growing the grid first: a
// trimmed or narrowed tab may have fewer columns or rows than the data, and getRange beyond the grid throws
// instead of extending it.
function writeTextCells(sheet, row, rows) {
  if (!rows.length) return;
  var width = rows[0].length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  var last = row + rows.length - 1;
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  var range = sheet.getRange(row, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setFontFamily(FONT_FAMILY);
  alignTopLeft(range);
  range.setValues(rows);
}

function writeHeaderRow(sheet, header) {
  writeTextCells(sheet, 1, [header]);
}

// Header, column widths and notes per tab kind; null for tabs the script does not shape: unknown '#' tabs,
// non-empty tabs without the ledger header and the tabs an extension owns (#GCal, #Slack, #Slack state).
function tabLayout(sheet) {
  var name = sheet.getName();
  if (extensionTabOwner(name) !== null) return null;
  if (name === HOLIDAYS_TAB) return { header: HOLIDAYS_HEADER, widths: HOLIDAYS_COLUMN_WIDTHS, notes: true, freeze: true };
  if (name === ALL_SHIFTS_TAB) return { header: null, widths: null, notes: false, freeze: false };
  if (name === STATUS_TAB) return { header: null, widths: STATUS_COLUMN_WIDTHS, notes: false, freeze: false };
  if (name === HELP_TAB) return { header: null, widths: [HELP_COLUMN_WIDTH], keep: HELP_COLUMNS, notes: false, freeze: false };
  if (isSystemTab(name) && !isKnownSystemTab(name)) return null;
  if (!isSystemTab(name) && !isEmptySheet(sheet) && !isLedgerHeader(headerCells(sheet))) return null;
  return { header: LEDGER_HEADER, widths: LEDGER_COLUMN_WIDTHS, notes: true, freeze: true };
}

// First-row cells of the ledger columns, padded to the ledger width; a tab narrower than the ledger has no
// header (getRange beyond the grid would throw).
function headerCells(sheet) {
  var cols = Math.min(LEDGER_HEADER.length, sheet.getMaxColumns());
  var cells = sheet.getRange(1, 1, 1, cols).getValues()[0];
  while (cells.length < LEDGER_HEADER.length) cells.push('');
  return cells;
}

// Deletes the columns beyond `width` when they hold nothing, so the trim never removes content.
function trimColumns(sheet, width) {
  if (sheet.getMaxColumns() > width && sheet.getLastColumn() <= width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
}

// Replaces the tab's conditional format rules with the script's set, one rule per formula over A:G.
function setConditionalRules(sheet, rules, width) {
  var range = sheet.getRange('A:' + String.fromCharCode(64 + width));
  sheet.setConditionalFormatRules(rules.map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(r.formula).setBackground(r.color).setRanges([range]).build();
  }));
}

// Idempotent formatting: font and top-left alignment on the whole tab, plain text on the whole ledger columns
// (A:G), bold grey frozen header, widths, notes and spare columns removed on tabs that have their header,
// conditional row colours on rotation tabs, their previews and #Global, tab colour on system tabs. Never
// touches cell values.
function formatTab(sheet) {
  var name = sheet.getName();
  var layout = tabLayout(sheet);
  if (!layout) return;
  var all = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  all.setFontFamily(FONT_FAMILY);
  alignTopLeft(all);
  var width = layout.header ? layout.header.length : layout.widths ? layout.widths.length : STATUS_WIDTH;
  var present = Math.min(width, sheet.getMaxColumns());
  sheet.getRange('A:' + String.fromCharCode(64 + present)).setNumberFormat('@');
  if (!layout.header && layout.widths) layout.widths.slice(0, present).forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  if (layout.header && !isEmptySheet(sheet)) {
    var header = sheet.getRange(1, 1, 1, width);
    header.setFontWeight('bold').setBackground(COLOR_HEADER);
    if (layout.freeze) sheet.setFrozenRows(1);
    layout.header.forEach(function (column, i) {
      sheet.setColumnWidth(i + 1, layout.widths[column]);
      if (layout.notes && COLUMN_NOTES[column]) header.getCell(1, i + 1).setNote(COLUMN_NOTES[column]);
    });
    trimColumns(sheet, width);
  }
  if (!layout.header && layout.keep) trimColumns(sheet, layout.keep);
  if (!isSystemTab(name) || isPreviewTab(name)) setConditionalRules(sheet, LEDGER_FORMAT_RULES, LEDGER_HEADER.length);
  if (name === GLOBAL_TAB) setConditionalRules(sheet, GLOBAL_FORMAT_RULES, LEDGER_HEADER.length);
  if (isSystemTab(name)) {
    var editable = name === HOLIDAYS_TAB || name === GLOBAL_TAB;
    sheet.setTabColor(name === HELP_TAB ? TAB_COLOR_HELP : editable ? TAB_COLOR_EDITABLE : TAB_COLOR_GENERATED);
  }
}

// Moves the tab to the 1-based position and restores the previously active tab.
function moveTab(ss, sheet, position) {
  var active = ss.getActiveSheet();
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(position);
  ss.setActiveSheet(active);
}

// A tab directly after its anchor: moved there once when it sits elsewhere; nothing without an anchor. A tab
// coming from before the anchor lands at the anchor's current index, since the anchor shifts up when it leaves.
function placeTabAfter(ss, sheet, anchor) {
  if (!anchor || sheet.getIndex() === anchor.getIndex() + 1) return;
  moveTab(ss, sheet, sheet.getIndex() < anchor.getIndex() ? anchor.getIndex() : anchor.getIndex() + 1);
}

// Formats an extension's preset tab like an editable system tab: script font, wrapped and top-left aligned,
// plain text, bold grey frozen header, the widths given, spare columns removed, the row colour rules given
// ({ formula, color }) replacing the tab's, grey tab colour.
function formatPresetTab(sheet, widths, rules) {
  var width = PRESET_HEADER.length;
  var all = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  all.setFontFamily(FONT_FAMILY);
  all.setWrap(true);
  alignTopLeft(all);
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(COLOR_HEADER);
  sheet.setFrozenRows(1);
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  trimColumns(sheet, width);
  setConditionalRules(sheet, rules, width);
  sheet.setTabColor(TAB_COLOR_EDITABLE);
}

// #Global directly before #Holidays; only moves when both exist and #Holidays comes first.
function orderGlobalBeforeHolidays(ss) {
  var global = ss.getSheetByName(GLOBAL_TAB);
  var holidays = ss.getSheetByName(HOLIDAYS_TAB);
  if (global && holidays && holidays.getIndex() < global.getIndex()) moveTab(ss, global, holidays.getIndex());
}

// #Help: helpText() in column A, first line and headings bold, moved to the last position; the active tab is kept.
function writeHelpTab(ss) {
  var sheet = ss.getSheetByName(HELP_TAB) || ss.insertSheet(HELP_TAB);
  sheet.clear();
  var lines = helpText();
  var range = sheet.getRange(1, 1, lines.length, 1);
  range.setNumberFormat('@');
  range.setWrap(true);
  alignTopLeft(range);
  range.setValues(lines.map(function (line) { return [line]; }));
  helpHeadingRows(lines).forEach(function (i) { sheet.getRange(i + 1, 1).setFontWeight('bold'); });
  moveTab(ss, sheet, ss.getNumSheets());
  return sheet;
}

function ensureTab(ss, name, header) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (header) writeHeaderRow(sheet, header);
  } else if (header && isEmptySheet(sheet)) {
    writeHeaderRow(sheet, header);
  }
  return sheet;
}

// #Global gets its header and one comment row explaining the tab when created or still empty.
// Template rows for a tab by name: rotation, #Global or #Holidays; null for tabs without a template.
function templateFor(name, storage) {
  var now = parseDateTime(storage.nowText);
  if (name === GLOBAL_TAB) return globalTemplateRows();
  if (name === HOLIDAYS_TAB) return holidaysTemplateRows(now);
  if (isSystemTab(name)) return null;
  return templateRows(recentMonday(now));
}

function writeTemplate(sheet, rows) {
  writeTextCells(sheet, 1, rows);
}

// Creates a missing tab and fills an empty one from its template.
function ensureTemplateTab(ss, name, storage) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (isEmptySheet(sheet)) writeTemplate(sheet, templateFor(name, storage));
  return sheet;
}

// Menu: Set Up Spreadsheet. Creates missing system tabs, a first rotation when there is none, lets each
// installed extension add its tabs (<prefix>_setup(ss); a failure is logged and named in the toast), and
// formats every tab. Under the lock, so it never reshapes tabs a run is writing.
function setupSpreadsheet() {
  return withLock(setupSpreadsheetUnlocked);
}

function setupSpreadsheetUnlocked() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss);
  if (!Object.keys(storage.readLedgers()).length) {
    var first = ss.getSheetByName(DEFAULT_ROTATION_TAB) || ss.insertSheet(DEFAULT_ROTATION_TAB, 0);
    if (isEmptySheet(first)) writeTemplate(first, templateFor(DEFAULT_ROTATION_TAB, storage));
  }
  ensureTemplateTab(ss, GLOBAL_TAB, storage);
  ensureTemplateTab(ss, HOLIDAYS_TAB, storage);
  ensureTab(ss, STATUS_TAB, null);
  ensureTab(ss, ALL_SHIFTS_TAB, SHIFTS_HEADER);
  orderGlobalBeforeHolidays(ss);
  var failed = [];
  callExtensionHooks('setup', [ss], function (h, e) { logExtensionError(h, e); failed.push(extensionErrorMessage(h, e)); });
  writeHelpTab(ss);
  ss.getSheets().forEach(formatTab);
  toast('Tabs, formatting and #Help are in place' + (failed.length ? '; ' + failed.join('; ') : ''));
}

// Menu: Set Up Tab. Fills the active tab according to its name; never overwrites content. An installed
// extension may take the tab first (<prefix>_setupTab(sheet) returning true, DESIGN 8).
function setupTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  var taken = callExtensionHooks('setupTab', [sheet], logExtensionError).some(function (r) { return r.value === true; });
  if (taken) return;
  if (isSystemTab(name) && !isKnownSystemTab(name)) { toast('"' + name + '" starts with # and is not a system tab; rename it to use it as a rotation'); return; }
  var owner = extensionTabOwner(name);
  if (owner !== null) { toast('"' + name + '" belongs to the ' + owner + ' extension; use Set Up Spreadsheet with the extension installed'); return; }
  if (name === STATUS_TAB || name === ALL_SHIFTS_TAB || name === HELP_TAB || isPreviewTab(name)) { toast('"' + name + '" is written by the script; nothing to fill in'); return; }
  if (!isEmptySheet(sheet)) { toast('"' + name + '" is not empty; Set Up Tab only fills empty tabs'); return; }
  writeTemplate(sheet, templateFor(name, new SheetsStorage(ss)));
  formatTab(sheet);
  toast('"' + name + '" set up from the template');
}

// Menu: Fill Shifts Grid over the selected rows of a rotation tab (DESIGN 10). Under the lock: it rewrites
// start cells a concurrent run may be re-sorting.
function fillShiftsGrid() {
  return withLock(fillShiftsGridUnlocked);
}

function fillShiftsGridUnlocked() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  var header = headerCells(sheet);
  if (isSystemTab(name) || !isLedgerHeader(header)) { toast('"' + name + '" is not a rotation tab'); return; }
  var selection = sheet.getActiveRange();
  var top = selection.getRow();
  var count = selection.getNumRows();
  if (count < 2 || top < 2) { toast('select more than one row below the header'); return; }
  var storage = new SheetsStorage(ss);
  var region = sheet.getRange(top, 1, count, LEDGER_HEADER.length);
  var selected = region.getValues().map(function (row) {
    return row.map(function (cell) { return storage.formatCell(cell, CELL_DATETIME_FORMAT); });
  });
  var tab = storage.readValues(sheet, CELL_DATETIME_FORMAT).slice(1);
  var result = fillShiftsGridCells(selected, tab, storage.readHolidays(), storage.readGlobal(), top - 2);
  if (result.error) { toast(result.error); return; }
  var rows = result.rows;
  if (rows.length > count) sheet.insertRowsAfter(top + count - 1, rows.length - count);
  var target = sheet.getRange(top, 1, rows.length, LEDGER_HEADER.length);
  target.setNumberFormat('@');
  target.setValues(rows);
  sheet.setActiveRange(target);
  toast(rows.length + ' row(s) on the grid, ' + (rows.length - count) + ' inserted');
}
