// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';
var FONT_FAMILY = 'Roboto Mono';
var TAB_COLOR_GENERATED = '#9e9e9e';
var TAB_COLOR_EDITABLE = '#4285f4';
var DEFAULT_ROTATION_TAB = 'On-Call';
var LEDGER_COLUMN_WIDTHS = { pin: 40, start: 150, type: 80, what: 320, end: 150, duration: 80, note: 320 };
var HOLIDAYS_COLUMN_WIDTHS = { date: 110, note: 320 };
var SHIFTS_COLUMN_WIDTHS = { start: 150, end: 150, rotation: 120, what: 120, pinned: 60, note: 320 };

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
      var header = sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0];
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

  // The #Links tab must carry the ledger header; anything else is ignored.
  readLinks() {
    var sheet = this.ss.getSheetByName(LINKS_TAB);
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
    if (!rows.length) return;
    var width = rows[0].length;
    var range = sheet.getRange(row, 1, rows.length, width);
    range.setNumberFormat('@');
    range.setValues(rows);
  }

  // Rows below the header of a ledger-shaped tab; previews go to '#Preview <name>' with a fresh header.
  writeLedgerRows(name, rows) {
    var sheet;
    if (this.preview) {
      sheet = this.previewSheet(name);
      sheet.clearContents();
      this.writeTextRows(sheet, 1, [LEDGER_HEADER]);
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

  writeLinks(rows) {
    this.writeLedgerRows(LINKS_TAB, rows);
  }

  writeTable(name, rows) {
    var sheet = this.sheetNamed(name);
    sheet.clearContents();
    this.writeTextRows(sheet, 1, rows);
  }

  // #Status and #All shifts tabs, rewritten in full from the status data (DESIGN 5.8).
  writeStatus(data) {
    this.writeTable(STATUS_TAB, statusRows(data));
    this.writeTable(ALL_SHIFTS_TAB, shiftsRows(data.shifts));
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rotalator')
    .addItem('Run now', 'run')
    .addItem('Dry run', 'dryRun')
    .addSeparator()
    .addItem('Set up', 'setup')
    .addItem('Template', 'template')
    .addItem('Fill Shifts Grid', 'fillShiftsGrid')
    .addSeparator()
    .addItem('Install nightly trigger', 'installTrigger')
    .addItem('Remove trigger', 'removeTrigger')
    .addToUi();
}

// On errors the ledgers are still written: rows unchanged plus error rows (DESIGN 6).
function runWith(preview) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss, { preview: preview });
  var result = runStorage(storage, storage.nowText, { write: true, mode: preview ? 'dry run' : 'run' });
  var title = preview ? 'Rotalator dry run' : 'Rotalator';
  var count = Object.keys(result.ledgers).length;
  var message = result.errors.length
    ? result.errors.length + ' error(s): ' + result.errors[0]
    : count + ' rotation(s) ' + (preview ? 'previewed' : 'updated') + ' at ' + storage.nowText;
  result.errors.forEach(function (e) { console.log(e); });
  ss.toast(message, title, 10);
  return result;
}

function run() {
  return runWith(false);
}

function dryRun() {
  return runWith(true);
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

function writeHeaderRow(sheet, header) {
  var range = sheet.getRange(1, 1, 1, header.length);
  range.setNumberFormat('@');
  range.setValues([header]);
}

// Header, column widths and notes per tab kind; null for tabs the script does not shape: unknown '#' tabs
// and non-empty tabs without the ledger header.
function tabLayout(sheet) {
  var name = sheet.getName();
  if (name === HOLIDAYS_TAB) return { header: HOLIDAYS_HEADER, widths: HOLIDAYS_COLUMN_WIDTHS, notes: true, freeze: true };
  if (name === ALL_SHIFTS_TAB) return { header: SHIFTS_HEADER, widths: SHIFTS_COLUMN_WIDTHS, notes: false, freeze: true };
  if (name === STATUS_TAB) return { header: null, widths: null, notes: false, freeze: false };
  if (isSystemTab(name) && !isKnownSystemTab(name)) return null;
  if (!isSystemTab(name) && !isEmptySheet(sheet) && !isLedgerHeader(sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0])) return null;
  return { header: LEDGER_HEADER, widths: LEDGER_COLUMN_WIDTHS, notes: true, freeze: true };
}

// Idempotent formatting: fonts, plain text on the whole ledger columns (A:G), bold frozen header, widths,
// notes and spare columns removed on tabs that have their header, tab colour on system tabs. Never touches
// cell values.
function formatTab(sheet) {
  var name = sheet.getName();
  var layout = tabLayout(sheet);
  if (!layout) return;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily(FONT_FAMILY);
  var width = layout.header ? layout.header.length : STATUS_WIDTH;
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  if (layout.header && !isEmptySheet(sheet)) {
    var header = sheet.getRange(1, 1, 1, width);
    header.setFontWeight('bold');
    if (layout.freeze) sheet.setFrozenRows(1);
    layout.header.forEach(function (column, i) {
      sheet.setColumnWidth(i + 1, layout.widths[column]);
      if (layout.notes && COLUMN_NOTES[column]) header.getCell(1, i + 1).setNote(COLUMN_NOTES[column]);
    });
    if (sheet.getMaxColumns() > width && sheet.getLastColumn() <= width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
  }
  if (isSystemTab(name)) {
    var editable = name === HOLIDAYS_TAB || name === LINKS_TAB;
    sheet.setTabColor(editable ? TAB_COLOR_EDITABLE : TAB_COLOR_GENERATED);
  }
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

// Rotation template into an empty tab: header, set row dated the most recent Monday 00:00, sample team.
function writeRotationTemplate(sheet, storage) {
  var rows = templateRows(recentMonday(parseDateTime(storage.nowText)));
  var range = sheet.getRange(1, 1, rows.length, LEDGER_HEADER.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

// Menu: Set up. Creates missing system tabs, a first rotation when there is none, and formats every tab.
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss);
  if (!Object.keys(storage.readLedgers()).length) {
    var first = ss.getSheetByName(DEFAULT_ROTATION_TAB) || ss.insertSheet(DEFAULT_ROTATION_TAB, 0);
    if (isEmptySheet(first)) writeRotationTemplate(first, storage);
  }
  ensureTab(ss, HOLIDAYS_TAB, HOLIDAYS_HEADER);
  ensureTab(ss, LINKS_TAB, LEDGER_HEADER);
  ensureTab(ss, STATUS_TAB, null);
  ensureTab(ss, ALL_SHIFTS_TAB, SHIFTS_HEADER);
  ss.getSheets().forEach(formatTab);
  toast('Tabs and formatting are in place');
}

// Menu: Template. Fills the active tab according to its name; never overwrites content.
function template() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) && !isKnownSystemTab(name)) { toast('"' + name + '" starts with # and is not a system tab; rename it to use it as a rotation'); return; }
  if (name === STATUS_TAB || name === ALL_SHIFTS_TAB || name.indexOf(PREVIEW_TAB_PREFIX) === 0) { toast('"' + name + '" is written by the script; nothing to fill in'); return; }
  if (!isEmptySheet(sheet)) { toast('"' + name + '" is not empty; the template only fills empty tabs'); return; }
  var layout = tabLayout(sheet);
  if (isSystemTab(name)) writeHeaderRow(sheet, layout.header);
  else writeRotationTemplate(sheet, new SheetsStorage(ss));
  formatTab(sheet);
  toast('"' + name + '" filled from the template');
}

// Menu: Fill Shifts Grid over the selected rows of a rotation tab (DESIGN 10).
function fillShiftsGrid() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  var header = sheet.getRange(1, 1, 1, LEDGER_HEADER.length).getValues()[0];
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
  var result = fillShiftsGridCells(selected, tab, storage.readHolidays());
  if (result.error) { toast(result.error); return; }
  var rows = result.rows;
  if (rows.length > count) sheet.insertRowsAfter(top + count - 1, rows.length - count);
  var target = sheet.getRange(top, 1, rows.length, LEDGER_HEADER.length);
  target.setNumberFormat('@');
  target.setValues(rows);
  sheet.setActiveRange(target);
  toast(rows.length + ' row(s) on the grid, ' + (rows.length - count) + ' inserted');
}
