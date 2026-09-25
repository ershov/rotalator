// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';
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
  { formula: '=OR($C1="attract", $C1="repel")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];
var GLOBAL_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="attract", $C1="repel")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];

// Storage interface of DESIGN 8 over the active spreadsheet. With preview set, ledgers are written to
// '#Preview <rotation>' tabs instead of the ledger tabs. Ledgers are written as plain text only.
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

  // Bold grey header rows, a green divider and yellow current cells, from the 0-based indexes the status
  // module reports in table { headerRows, dividerRows, currentCells }.
  formatTableRows(sheet, width, table) {
    var paint = function (indexes, color) {
      (indexes || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setBackground(color); });
    };
    (table.headerRows || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setFontWeight('bold'); });
    paint(table.headerRows, COLOR_HEADER);
    paint(table.dividerRows, COLOR_DIVIDER);
    (table.currentCells || []).forEach(function (c) { sheet.getRange(c.row + 1, c.col + 1).setBackground(COLOR_CURRENT_CELL); });
  }

  // Rows below the header of a ledger-shaped tab; previews go to '#Preview <name>' with a fresh header.
  writeLedgerRows(name, rows) {
    var sheet;
    if (this.preview) {
      sheet = this.previewSheet(name);
      sheet.clear();
      this.writeTextRows(sheet, 1, [LEDGER_HEADER]);
      this.formatTableRows(sheet, LEDGER_HEADER.length, { headerRows: [0] });
    } else {
      sheet = this.ss.getSheetByName(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, LEDGER_HEADER.length).clearContent();
    }
    this.writeTextRows(sheet, 2, rows);
  }

  writeLedger(rotation, rows) {
    this.writeLedgerRows(rotation, rows);
  }

  writeGlobal(rows) {
    this.writeLedgerRows(GLOBAL_TAB, rows);
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

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rotalator')
    .addItem('Run', 'run')
    .addItem('Run - dry run', 'dryRun')
    .addItem('Run for current rotation', 'runCurrent')
    .addItem('Run for current rotation - dry run', 'dryRunCurrent')
    .addSeparator()
    .addItem('Set Up Spreadsheet', 'setupSpreadsheet')
    .addItem('Set Up Tab', 'setupTab')
    .addItem('Fill Shifts Grid', 'fillShiftsGrid')
    .addSeparator()
    .addItem('Install nightly trigger', 'installTrigger')
    .addItem('Remove trigger', 'removeTrigger')
    .addToUi();
}

// On errors the ledgers are still written: rows unchanged plus error rows (DESIGN 6).
// rotations: names to regenerate, or null for all.
function runWith(preview, rotations) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss, { preview: preview });
  var options = { write: true, mode: preview ? 'dry run' : 'run' };
  if (rotations) options.rotations = rotations;
  var result = runStorage(storage, storage.nowText, options);
  var title = preview ? 'Rotalator dry run' : 'Rotalator';
  var what = rotations ? rotations.join(', ') : Object.keys(result.ledgers).length + ' rotation(s)';
  var message = result.errors.length
    ? result.errors.length + ' error(s): ' + result.errors[0]
    : what + ' ' + (preview ? 'previewed' : 'updated') + ' at ' + storage.nowText;
  result.errors.forEach(function (e) { console.log(e); });
  ss.toast(message, title, 10);
  return result;
}

function run() {
  return runWith(false, null);
}

function dryRun() {
  return runWith(true, null);
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
  return name === null ? null : runWith(false, [name]);
}

function dryRunCurrent() {
  var name = currentRotation();
  return name === null ? null : runWith(true, [name]);
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

// Writes rows as plain text in the script font from `row` down, growing the grid first: a trimmed or narrowed
// tab may have fewer columns or rows than the data, and getRange beyond the grid throws instead of extending it.
function writeTextCells(sheet, row, rows) {
  if (!rows.length) return;
  var width = rows[0].length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  var last = row + rows.length - 1;
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  var range = sheet.getRange(row, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setFontFamily(FONT_FAMILY);
  range.setValues(rows);
}

function writeHeaderRow(sheet, header) {
  writeTextCells(sheet, 1, [header]);
}

// Header, column widths and notes per tab kind; null for tabs the script does not shape: unknown '#' tabs
// and non-empty tabs without the ledger header.
function tabLayout(sheet) {
  var name = sheet.getName();
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

// Idempotent formatting: fonts, plain text on the whole ledger columns (A:G), bold grey frozen header,
// widths, notes and spare columns removed on tabs that have their header, conditional row colours on
// rotation tabs and #Global, tab colour on system tabs. Never touches cell values.
function formatTab(sheet) {
  var name = sheet.getName();
  var layout = tabLayout(sheet);
  if (!layout) return;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily(FONT_FAMILY);
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
  if (!isSystemTab(name)) setConditionalRules(sheet, LEDGER_FORMAT_RULES, LEDGER_HEADER.length);
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

// #Global directly before #Holidays; only moves when both exist and #Holidays comes first.
function orderGlobalBeforeHolidays(ss) {
  var global = ss.getSheetByName(GLOBAL_TAB);
  var holidays = ss.getSheetByName(HOLIDAYS_TAB);
  if (global && holidays && holidays.getIndex() < global.getIndex()) moveTab(ss, global, holidays.getIndex());
}

// #Help: HELP_TEXT in column A, first line and headings bold, moved to the last position; the active tab is kept.
function writeHelpTab(ss) {
  var sheet = ss.getSheetByName(HELP_TAB) || ss.insertSheet(HELP_TAB);
  sheet.clear();
  var range = sheet.getRange(1, 1, HELP_TEXT.length, 1);
  range.setNumberFormat('@');
  range.setWrap(true);
  range.setValues(HELP_TEXT.map(function (line) { return [line]; }));
  helpHeadingRows().forEach(function (i) { sheet.getRange(i + 1, 1).setFontWeight('bold'); });
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
  if (name === GLOBAL_TAB) return globalTemplateRows(recentMonday(now));
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

// Menu: Set Up Spreadsheet. Creates missing system tabs, a first rotation when there is none, and formats
// every tab.
function setupSpreadsheet() {
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
  writeHelpTab(ss);
  ss.getSheets().forEach(formatTab);
  toast('Tabs, formatting and #Help are in place');
}

// Menu: Set Up Tab. Fills the active tab according to its name; never overwrites content.
function setupTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) && !isKnownSystemTab(name)) { toast('"' + name + '" starts with # and is not a system tab; rename it to use it as a rotation'); return; }
  if (name === STATUS_TAB || name === ALL_SHIFTS_TAB || name === HELP_TAB || name.indexOf(PREVIEW_TAB_PREFIX) === 0) { toast('"' + name + '" is written by the script; nothing to fill in'); return; }
  if (!isEmptySheet(sheet)) { toast('"' + name + '" is not empty; Set Up Tab only fills empty tabs'); return; }
  writeTemplate(sheet, templateFor(name, new SheetsStorage(ss)));
  formatTab(sheet);
  toast('"' + name + '" set up from the template');
}

// Menu: Fill Shifts Grid over the selected rows of a rotation tab (DESIGN 10).
function fillShiftsGrid() {
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
  var result = fillShiftsGridCells(selected, tab, storage.readHolidays(), storage.readGlobal());
  if (result.error) { toast(result.error); return; }
  var rows = result.rows;
  if (rows.length > count) sheet.insertRowsAfter(top + count - 1, rows.length - count);
  var target = sheet.getRange(top, 1, rows.length, LEDGER_HEADER.length);
  target.setNumberFormat('@');
  target.setValues(rows);
  sheet.setActiveRange(target);
  toast(rows.length + ' row(s) on the grid, ' + (rows.length - count) + ' inserted');
}
