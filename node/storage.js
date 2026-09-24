'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');

// Storage interface of DESIGN 8. Ledgers are cell arrays without the header row; holidays are date texts
// (null for a blank row); global holds the #Global rows; ignored are tab names reported in #Status.
class MemoryStorage {
  constructor({ ledgers = {}, holidays = [], global = [], ignored = [] } = {}) {
    this.ledgers = structuredClone(ledgers);
    this.holidays = holidays.slice();
    this.global = structuredClone(global);
    this.ignored = ignored.slice();
    this.status = null;
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
// header), holidays.csv is #Holidays, global.csv is #Global, status.json holds the #Status and #All shifts data,
// now.txt is the run instant. A file named #<anything>.csv is never a rotation, like a '#' tab.
// Blank lines are kept as all-empty rows so row numbers match the file; callers drop them.
class CsvDirStorage {
  constructor(dir) {
    this.dir = dir;
    this.U = load();
    this.tabs = null;
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
      if (!name.endsWith('.csv') || name === 'holidays.csv' || name === 'global.csv') return;
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
