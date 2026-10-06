'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Apps Script adapter (src/90_gas.js) against a small mock of the services it uses; just enough of
// SpreadsheetApp for Set Up Spreadsheet.
const SRC = path.join(__dirname, '..', 'src');

// Formatting calls are recorded on the sheet as 'method' or 'method A:Z' for whole-column ranges.
class Range {
  constructor(sheet, r, c, n, w, a1) { Object.assign(this, { sheet, r, c, n, w, a1 }); }
  getValues() { return this.sheet.values.slice(this.r - 1, this.r - 1 + this.n).map((row) => { const o = []; for (let j = this.c - 1; j < this.c - 1 + this.w; j++) o.push(row && row[j] !== undefined ? row[j] : ''); return o; }); }
  setValues(v) { for (let i = 0; i < this.n; i++) this.sheet.values[this.r - 1 + i] = v[i].slice(); return this; }
  clearContent() { return this; }
  getCell() { return this; }
}
for (const m of ['setNumberFormat', 'setFontFamily', 'setFontWeight', 'setBackground', 'setNote', 'setWrap', 'setVerticalAlignment', 'setHorizontalAlignment']) {
  Range.prototype[m] = function () { this.sheet.calls.push(this.a1 ? `${m} ${this.a1}` : m); return this; };
}
const columnIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

class Sheet {
  constructor(name, values = []) { this.name = name; this.values = values; this.calls = []; this.color = null; this.rules = []; }
  getName() { return this.name; }
  getDataRange() { return new Range(this, 1, 1, this.values.length, this.getMaxColumns()); }
  getLastRow() { return this.values.length; }
  getLastColumn() { return Math.max(0, ...this.values.map((r) => r.length)); }
  getMaxRows() { return Math.max(this.values.length, 100); }
  getMaxColumns() { return Math.max(this.getLastColumn(), 26); }
  getRange(a, c, n, w) {
    if (typeof a === 'string') { const [from, to] = a.split(':').map(columnIndex); return new Range(this, 1, from, this.getMaxRows(), to - from + 1, a); }
    return new Range(this, a, c, n ?? 1, w ?? 1);
  }
  clear() { this.values = []; return this; }
  clearNotes() { return this; }
  setFrozenRows() { return this; } setColumnWidth() { return this; } setTabColor(c) { this.color = c; return this; }
  setConditionalFormatRules(r) { this.rules = r; } deleteColumns() {} insertColumnsAfter() {} insertRowsAfter() {}
  getIndex() { return this.ss.sheets.indexOf(this) + 1; }
}

// A spreadsheet with the given sheets, the services and the loaded adapter; returns { ss, log, state, run }.
// `theme` null stands for a spreadsheet without a theme.
function spreadsheet(initial, theme = { font: null, setFontFamily(f) { this.font = f; return this; } }) {
  const ss = {
    sheets: [], toasts: [], active: null, theme, appliedTheme: null,
    getSpreadsheetTheme() { return this.theme; },
    setSpreadsheetTheme(t) { this.appliedTheme = t; },
    getSpreadsheetTimeZone: () => 'UTC',
    getSheets() { return this.sheets.slice(); },
    getNumSheets() { return this.sheets.length; },
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; },
    insertSheet(n, i) { const s = new Sheet(n); s.ss = this; if (i === undefined) this.sheets.push(s); else this.sheets.splice(i, 0, s); return s; },
    getActiveSheet() { return this.active || this.sheets[0]; },
    setActiveSheet(s) { this.active = s; },
    moveActiveSheet(pos) { const s = this.active; this.sheets.splice(this.sheets.indexOf(s), 1); this.sheets.splice(pos - 1, 0, s); },
    toast(msg, title) { this.toasts.push(`${title}: ${msg}`); },
  };
  initial.forEach((s) => { s.ss = ss; ss.sheets.push(s); });
  const log = [];
  const state = { flushes: 0, flushedBeforeSweep: null };
  const lock = { held: false, tryLock() { if (this.held) return false; this.held = true; return true; }, releaseLock() { this.held = false; } };
  const ctx = vm.createContext({
    console: { log: (line) => log.push(String(line)) },
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
      flush() { state.flushes++; },
      newConditionalFormatRule: () => ({ whenFormulaSatisfied() { return this; }, setBackground() { return this; }, setRanges() { return this; }, build() { return {}; } }),
    },
    ScriptApp: { getProjectTriggers: () => [] },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 16), parseDate: (t) => new Date(t + ':00Z') },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-10-07T10:00:00Z'])); } },
  });
  fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort().forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  return { ss, log, state, run: (code) => vm.runInContext(code, ctx) };
}

test('Set Up Spreadsheet survives a sheet that cannot be formatted: flushes first, skips it, logs and toasts it', () => {
  const { ss, log, state, run } = spreadsheet([new Sheet('Notes', [['hello']])], null);
  // A stale handle: after the flush the service lists a tab that no longer resolves. Gating the ghost on the
  // flush documents the order flush-then-sweep; that the flush fixes the live failure is a hypothesis this
  // test does not prove.
  const ghost = new Sheet('ghost');
  ghost.getName = () => { throw new Error('Sheet 330418220 not found'); };
  const originalGetSheets = ss.getSheets.bind(ss);
  ss.getSheets = () => (state.flushes ? originalGetSheets().concat([ghost]) : originalGetSheets());
  run('setupSpreadsheet()');
  assert.equal(state.flushes, 1);
  const names = ss.sheets.map((s) => s.name);
  assert.equal(names[0], 'Rotation 1 Primary');
  assert.ok(['#Global', '#Holidays', '#Status', '#All shifts'].every((n) => names.includes(n)));
  assert.equal(names.at(-1), '#Help');
  // Every other tab was formatted; the ghost was skipped and reported.
  const formatted = (n) => ss.getSheetByName(n).calls.includes('setFontFamily A:Z');
  assert.ok(['Rotation 1 Primary', '#Global', '#Holidays', '#Status', '#All shifts', '#Help'].every(formatted));
  assert.deepEqual(ghost.calls, []);
  assert.equal(ss.toasts.at(-1), 'Rotalator: Tabs, formatting and #Help are in place; formatting tab: Sheet 330418220 not found');
  assert.deepEqual(log.filter((l) => l.startsWith('error:')), ['error: formatting tab: Sheet 330418220 not found']);
  // Without the ghost the toast carries no failure.
  const clean = spreadsheet([]);
  clean.run('setupSpreadsheet()');
  assert.equal(clean.ss.toasts.at(-1), 'Rotalator: Tabs, formatting and #Help are in place');
  assert.deepEqual(clean.log, []);
});

test('Set Up Spreadsheet formats whole columns and sets the theme font, so rows added later inherit them', () => {
  const { ss, run } = spreadsheet([]);
  run('setupSpreadsheet()');
  assert.equal(ss.appliedTheme, ss.theme);
  assert.equal(ss.theme.font, 'Roboto Mono');
  const calls = ss.getSheetByName('Rotation 1 Primary').calls;
  // The template write also formats its own bounded range; the tab-wide formats must be whole-column.
  for (const m of ['setFontFamily', 'setVerticalAlignment', 'setHorizontalAlignment']) {
    assert.ok(calls.includes(`${m} A:Z`), `${m} on the whole columns`);
  }
  assert.ok(calls.includes('setNumberFormat A:G'));
  // A spreadsheet without a theme is left alone and still set up.
  const bare = spreadsheet([], null);
  bare.run('setupSpreadsheet()');
  assert.equal(bare.ss.appliedTheme, null);
  assert.equal(bare.ss.toasts.at(-1), 'Rotalator: Tabs, formatting and #Help are in place');
});
