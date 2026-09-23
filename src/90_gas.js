// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';

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
