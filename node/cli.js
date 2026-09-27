'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');
const { CsvDirStorage } = require('./storage.js');

const DEFAULT_ROTATION = 'Rotation 1 Primary';

const USAGE = `usage:
  rotalator run DIR [--now YYYY-MM-DDTHH:MM] [--rotation NAME]... [--write] [--status]
  rotalator init DIR [--rotation NAME] [--start YYYY-MM-DDTHH:MM] [--history-from YYYY-MM-DD] [--now YYYY-MM-DDTHH:MM]
  rotalator export DIR [--now YYYY-MM-DDTHH:MM] [--rotation NAME]... [--repair]
  rotalator help

run     regenerates the ledgers in DIR and prints them as CSV; --write saves them, --status appends the status tables.
        --rotation limits regeneration to the named rotations; the others are read but left untouched.
init    creates <NAME>.csv (default "Rotation 1 Primary") from the rotation template, plus holidays.csv and now.txt when missing.
        --start dates the set and team rows (default: the most recent Monday 00:00 before now);
        --history-from adds empty shift rows on the grid from that date up to --start.
export  prints the Google Calendar export plan (GCal extension) for the rotations with a cal setting, from gcal.csv;
        nothing is written and no calendar is touched. --repair plans every shift from the first one.
`;

function ledgerCsv(rows) {
  const U = load();
  return U.formatCsv([U.LEDGER_HEADER, ...rows]);
}

// Runs the src runner; the result is cloned out of the vm context.
function runStorage(storage, nowText, options = {}) {
  return structuredClone(load().runStorage(storage, nowText, options));
}

// Space-padded columns, aligned within each block of rows separated by blank rows.
function textTable(rows) {
  const blocks = [[]];
  rows.forEach((r) => (r.every((c) => c === '') ? blocks.push([]) : blocks[blocks.length - 1].push(r)));
  return blocks.map((block) => {
    const widths = [];
    block.forEach((r) => r.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 0, String(c).length); }));
    return block.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd() + '\n').join('');
  }).join('\n');
}

function statusText(status) {
  const U = load();
  return textTable(U.statusRowsVertical(status).rows) + '\n' + textTable(U.shiftsRows(status).rows);
}

// Plan of the GCal extension as text: one block per rotation, the events table, then the errors.
function planText(plan) {
  const rows = [];
  plan.rotations.forEach((r) => {
    rows.push(['rotation', r.rotation], ['presets', r.presets.join(', ')], ['window', `${r.from} to ${r.to}`], ['shifts', String(r.shifts)], ['skipped', String(r.skipped)], []);
  });
  if (plan.events.length) {
    rows.push(['key', 'preset', 'calendar', 'start', 'end', 'all day', 'title', 'guests', 'reminders']);
    plan.events.forEach((e) => rows.push([e.key, e.preset, e.calendar, e.start, e.end, e.allDay ? 'yes' : 'no', e.title, e.guests.join(' '), e.reminders.join(' ')]));
    rows.push([]);
  }
  if (plan.errors.length) {
    rows.push(['error', 'where', 'message']);
    plan.errors.forEach((e) => rows.push(['', e.where, e.message]));
  }
  return textTable(rows);
}

// Runs the scheduler without writing (the GCal export hook is left to the caller) and plans the export.
function exportDir(dir, nowText, { rotations = null, repair = false } = {}) {
  const U = load(['GCal']);
  const result = runDir(dir, nowText, { rotations, export: false });
  if (result.errors.length) return { result, plan: null };
  return { result, plan: structuredClone(U.gcalPlan(result, result.ext.gcal, { repair, rotations: rotations || undefined })) };
}

// A directory with a gcal.csv gets the GCal extension, so the CLI mirrors the spreadsheet: error rows written
// with --write, the Calendar block in --status, exit 1 on preset errors, no calendar calls in Node. Without
// write the storage is read-only.
function runDir(dir, nowText, options = {}) {
  if (fs.existsSync(path.join(dir, 'gcal.csv'))) load(['GCal']);
  const storage = new CsvDirStorage(dir, { readOnly: !options.write });
  return runStorage(storage, nowText ?? storage.readNow(), options);
}

function localNowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseInstant(U, text, what) {
  const min = U.parseDateTime(text);
  if (min === null) throw new Error(`bad ${what} "${text}"`);
  return min;
}

// Creates <rotation>.csv from the template in dir; holidays.csv and now.txt only when missing.
// With historyFrom, the set and team rows are dated at the first grid boundary at or after it and empty
// shift rows follow up to start, so the ledger validates and start stays a grid instant.
function initDir(dir, { rotation = DEFAULT_ROTATION, start = null, historyFrom = null, now = null }) {
  const U = load();
  if (!rotation) throw new Error('init needs --rotation NAME');
  if (U.isSystemTab(rotation) || !U.isValidMemberId(rotation) || rotation.includes('/')) throw new Error(`bad rotation name "${rotation}"`);
  fs.mkdirSync(dir, { recursive: true });
  const ledgerFile = path.join(dir, `${rotation}.csv`);
  if (fs.existsSync(ledgerFile)) throw new Error(`${ledgerFile} already exists`);
  const nowFile = path.join(dir, 'now.txt');
  const nowText = now ?? (fs.existsSync(nowFile) ? fs.readFileSync(nowFile, 'utf8').trim() : localNowText());
  const nowMin = parseInstant(U, nowText, 'now');
  const startMin = start === null ? U.recentMonday(nowMin) : parseInstant(U, start, 'start');

  let cells = U.templateRows(startMin);
  if (historyFrom !== null) {
    const from = parseInstant(U, historyFrom, 'history-from');
    if (from >= startMin) throw new Error('--history-from must be before the start');
    const timeline = new U.SettingsTimeline(U.rowsOfType(U.rowsFromCells(cells.slice(1)), 'set'), new Set());
    const grid = timeline.gridAt(startMin);
    const first = grid.ceil(from);
    let count = 0;
    for (let t = first; t < startMin; t = grid.next(t)) count++;
    if (count > 0) {
      const template = U.templateRows(first);
      const rows = U.rowsFromCells(template.slice(1));
      const shifted = new U.SettingsTimeline(U.rowsOfType(rows, 'set'), new Set());
      cells = [template[0], ...U.gridRows(rows, 0, count, shifted).map(U.rowToArray)];
    }
  }
  const written = [];
  fs.writeFileSync(ledgerFile, U.formatCsv(structuredClone(cells)));
  written.push(ledgerFile);
  const holidaysFile = path.join(dir, 'holidays.csv');
  if (!fs.existsSync(holidaysFile)) { fs.writeFileSync(holidaysFile, U.formatCsv(structuredClone(U.holidaysTemplateRows(nowMin)))); written.push(holidaysFile); }
  if (!fs.existsSync(nowFile)) { fs.writeFileSync(nowFile, nowText + '\n'); written.push(nowFile); }
  return { files: written, start: cells.find((r) => r[2] === 'set' && r[1] !== '')[1], now: nowText };
}

function takeValue(argv, i, flag) {
  if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
  return argv[i + 1];
}

// "run DIR ..." or the older "--dir DIR ..." form.
function parseRunArgs(argv) {
  const args = { dir: null, now: null, rotations: [], write: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = takeValue(argv, i++, a);
    else if (a === '--now') args.now = takeValue(argv, i++, a);
    else if (a === '--rotation') args.rotations.push(takeValue(argv, i++, a));
    else if (a === '--write') args.write = true;
    else if (a === '--status') args.status = true;
    else if (!a.startsWith('--') && args.dir === null) args.dir = a;
    else throw new Error(`unknown argument "${a}"`);
  }
  if (!args.dir) throw new Error(USAGE);
  return args;
}

function parseExportArgs(argv) {
  const args = { dir: null, now: null, rotations: [], repair: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--now') args.now = takeValue(argv, i++, a);
    else if (a === '--rotation') args.rotations.push(takeValue(argv, i++, a));
    else if (a === '--repair') args.repair = true;
    else if (!a.startsWith('--') && args.dir === null) args.dir = a;
    else throw new Error(`unknown argument "${a}"`);
  }
  if (!args.dir) throw new Error(USAGE);
  return args;
}

function parseInitArgs(argv) {
  const args = { dir: null, rotation: DEFAULT_ROTATION, start: null, historyFrom: null, now: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rotation') args.rotation = takeValue(argv, i++, a);
    else if (a === '--start') args.start = takeValue(argv, i++, a);
    else if (a === '--history-from') args.historyFrom = takeValue(argv, i++, a);
    else if (a === '--now') args.now = takeValue(argv, i++, a);
    else if (!a.startsWith('--') && args.dir === null) args.dir = a;
    else throw new Error(`unknown argument "${a}"`);
  }
  if (!args.dir) throw new Error(USAGE);
  return args;
}

function mainRun(argv) {
  const args = parseRunArgs(argv);
  const result = runDir(args.dir, args.now, { write: args.write, rotations: args.rotations.length ? args.rotations : null });
  Object.keys(result.ledgers).forEach((name) => {
    process.stdout.write(`# ${name}\n` + ledgerCsv(result.ledgers[name]));
  });
  if (result.global) process.stdout.write(`# ${load().GLOBAL_TAB}\n` + ledgerCsv(result.global));
  if (args.status && result.status) process.stdout.write('\n' + statusText(result.status));
  result.errors.forEach((e) => process.stderr.write(e + '\n'));
  return result.errors.length ? 1 : 0;
}

function mainExport(argv) {
  const args = parseExportArgs(argv);
  const { result, plan } = exportDir(args.dir, args.now, { rotations: args.rotations.length ? args.rotations : null, repair: args.repair });
  if (!plan) { result.errors.forEach((e) => process.stderr.write(e + '\n')); return 1; }
  process.stdout.write(planText(plan));
  plan.errors.forEach((e) => process.stderr.write(`${e.where}: ${e.message}\n`));
  return plan.errors.length ? 1 : 0;
}

function mainInit(argv) {
  const args = parseInitArgs(argv);
  const result = initDir(args.dir, args);
  result.files.forEach((f) => process.stdout.write(`wrote ${f}\n`));
  process.stdout.write(`set and team rows dated ${result.start}, now ${result.now}\n`);
  return 0;
}

function main(argv) {
  try {
    const [command, ...rest] = argv;
    if (command === 'run') return mainRun(rest);
    if (command === 'init') return mainInit(rest);
    if (command === 'export') return mainExport(rest);
    if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
      process.stdout.write(USAGE);
      return command === undefined ? 1 : 0;
    }
    if (command.startsWith('--')) return mainRun(argv);
    throw new Error(`unknown command "${command}"\n${USAGE}`);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runStorage, runDir, ledgerCsv, statusText, initDir, exportDir, planText, main };
