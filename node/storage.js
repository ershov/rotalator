'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');

function isBlankRow(cells) {
  return cells.every((c) => String(c ?? '').trim() === '');
}

// Storage interface of DESIGN 8. Ledgers are cell arrays without the header row; holidays are date texts
// (null for a blank row).
class MemoryStorage {
  constructor({ ledgers = {}, holidays = [], links = [] } = {}) {
    this.ledgers = structuredClone(ledgers);
    this.holidays = holidays.slice();
    this.links = structuredClone(links);
    this.status = null;
  }

  readLedgers() {
    return structuredClone(this.ledgers);
  }

  readHolidays() {
    return this.holidays.slice();
  }

  readLinks() {
    return structuredClone(this.links);
  }

  writeLedger(rotation, rows) {
    this.ledgers[rotation] = structuredClone(rows);
  }

  writeStatus(data) {
    this.status = data;
  }
}

// Directory of <rotation>.csv ledgers (recognised by header), holidays.csv, optional links.csv, now.txt.
// Blank lines are kept as all-empty rows so row numbers match the file; callers drop them.
class CsvDirStorage {
  constructor(dir) {
    this.dir = dir;
    this.U = load();
  }

  file(name) {
    return path.join(this.dir, name);
  }

  readCsv(name) {
    const file = this.file(name);
    return fs.existsSync(file) ? this.U.parseCsv(fs.readFileSync(file, 'utf8')) : null;
  }

  readLedgers() {
    const ledgers = {};
    fs.readdirSync(this.dir).sort().forEach((name) => {
      if (!name.endsWith('.csv') || name === 'holidays.csv' || name === 'links.csv') return;
      const rows = this.readCsv(name);
      if (rows.length && this.U.isLedgerHeader(rows[0])) ledgers[name.slice(0, -4)] = rows.slice(1);
    });
    return ledgers;
  }

  readHolidays() {
    const rows = this.readCsv('holidays.csv') || [];
    const body = rows.length && String(rows[0][0]).trim().toLowerCase() === 'date' ? rows.slice(1) : rows;
    return body.map((r) => (isBlankRow(r) ? null : String(r[0] ?? '').trim()));
  }

  readLinks() {
    const rows = this.readCsv('links.csv') || [];
    return rows.length && this.U.isLedgerHeader(rows[0]) ? rows.slice(1) : rows;
  }

  readNow() {
    const file = this.file('now.txt');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  }

  writeLedger(rotation, rows) {
    fs.writeFileSync(this.file(rotation + '.csv'), this.U.formatCsv([this.U.LEDGER_HEADER, ...rows]));
  }

  writeStatus(data) {
    fs.writeFileSync(this.file('status.json'), JSON.stringify(data, null, 2) + '\n');
  }
}

module.exports = { MemoryStorage, CsvDirStorage, isBlankRow };
