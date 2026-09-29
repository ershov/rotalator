'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');

// Files of the system tabs in a CSV directory; every other <name>.csv is a rotation candidate.
const TAB_FILES = { '#Holidays': 'holidays.csv', '#Global': 'global.csv', '#GCal': 'gcal.csv', '#Slack': 'slack.csv', '#Slack state': 'slack-state.csv' };

// Storage interface of DESIGN 8. Ledgers are cell arrays without the header row; holidays are date texts
// (null for a blank row); global holds the #Global rows; ignored are tab names reported in #Status; tabs holds
// the rows below the header of any other tab an extension reads (tabs['#GCal']); writeTabRows creates a missing
// entry.
class MemoryStorage {
  constructor({ ledgers = {}, holidays = [], global = [], ignored = [], tabs = {} } = {}) {
    this.ledgers = structuredClone(ledgers);
    this.holidays = holidays.slice();
    this.global = structuredClone(global);
    this.ignored = ignored.slice();
    this.tabs = structuredClone(tabs);
    this.status = null;
  }

  readTabRows(name) {
    return structuredClone(this.tabs[name] || []);
  }

  writeTabRows(name, header, rows) {
    this.tabs[name] = structuredClone(rows);
  }

  ignoredTabs() {
    return this.ignored.slice();
  }

  readLedgers() {
    return structuredClone(this.ledgers);
  }

  readHolidays() {
    return this.holidays.slice();
  }

  readGlobal() {
    return structuredClone(this.global);
  }

  writeLedger(rotation, rows) {
    this.ledgers[rotation] = structuredClone(rows);
  }

  writeGlobal(rows) {
    this.global = structuredClone(rows);
  }

  writeStatus(data) {
    this.status = data;
  }
}

// Directory form of the spreadsheet. File to tab mapping: <rotation>.csv is a rotation tab (recognised by
// header), holidays.csv is #Holidays, global.csv is #Global, gcal.csv is #GCal, slack.csv is #Slack,
// slack-state.csv is #Slack state, status.json holds the #Status and #All shifts data, now.txt is the run
// instant. A file named #<anything>.csv is never a rotation, like a '#' tab.
// Blank lines are kept as all-empty rows so row numbers match the file; callers drop them.
// readOnly: the writers are no-ops, for a run that only prints (the runner itself writes only when asked, but
// an extension may write its own tab from readInputs).
class CsvDirStorage {
  constructor(dir, { readOnly = false } = {}) {
    this.dir = dir;
    this.U = load();
    this.tabs = null;
    this.readOnly = readOnly;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  readCsv(name) {
    const file = this.file(name);
    return fs.existsSync(file) ? this.U.parseCsv(fs.readFileSync(file, 'utf8')) : null;
  }

  scanTabs() {
    if (this.tabs) return this.tabs;
    const ledgers = {};
    const ignored = [];
    fs.readdirSync(this.dir).sort().forEach((name) => {
      if (!name.endsWith('.csv') || Object.values(TAB_FILES).includes(name)) return;
      const tab = name.slice(0, -4);
      const rows = this.readCsv(name);
      if (!this.U.isSystemTab(tab) && rows.length && this.U.isLedgerHeader(rows[0])) ledgers[tab] = rows.slice(1);
      else ignored.push(tab);
    });
    this.tabs = { ledgers, ignored };
    return this.tabs;
  }

  readLedgers() {
    return structuredClone(this.scanTabs().ledgers);
  }

  ignoredTabs() {
    return this.scanTabs().ignored.slice();
  }

  readHolidays() {
    const rows = this.readCsv('holidays.csv') || [];
    const body = rows.length && String(rows[0][0]).trim().toLowerCase() === 'date' ? rows.slice(1) : rows;
    return body.map((r) => (this.U.isBlankRow(r) ? null : String(r[0] ?? '').trim()));
  }

  // global.csv must carry the ledger header; anything else is ignored.
  readGlobal() {
    const rows = this.readCsv('global.csv') || [];
    return rows.length && this.U.isLedgerHeader(rows[0]) ? rows.slice(1) : [];
  }

  // Rows below the header of a system tab's file (TAB_FILES, else <name>.csv); [] without the file or its header.
  readTabRows(name, header) {
    const rows = this.readCsv(TAB_FILES[name] ?? `${name}.csv`) || [];
    const first = rows.length ? rows[0].map((c) => String(c ?? '').trim().toLowerCase()) : [];
    return header.every((h, i) => first[i] === h) ? rows.slice(1) : [];
  }

  // The mirror of readTabRows: header plus rows into the tab's file, created when missing.
  writeTabRows(name, header, rows) {
    if (this.readOnly) return;
    fs.writeFileSync(this.file(TAB_FILES[name] ?? `${name}.csv`), this.U.formatCsv([header, ...rows]));
  }

  readNow() {
    const file = this.file('now.txt');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  }

  writeLedger(rotation, rows) {
    fs.writeFileSync(this.file(rotation + '.csv'), this.U.formatCsv([this.U.LEDGER_HEADER, ...rows]));
  }

  writeGlobal(rows) {
    fs.writeFileSync(this.file('global.csv'), this.U.formatCsv([this.U.LEDGER_HEADER, ...rows]));
  }

  writeStatus(data) {
    fs.writeFileSync(this.file('status.json'), JSON.stringify(data, null, 2) + '\n');
  }
}

module.exports = { MemoryStorage, CsvDirStorage };
