'use strict';
const { load } = require('./load.js');
const { CsvDirStorage, isBlankRow } = require('./storage.js');

function ledgerCsv(rows) {
  const U = load();
  return U.formatCsv([U.LEDGER_HEADER, ...rows]);
}

function describeError(U, e) {
  const where = e.rowIndex !== null && e.rowIndex !== undefined ? `row ${e.rowIndex}` : e.start !== null && e.start !== undefined ? U.formatDateTime(e.start) : 'ledger';
  return `${e.rotation} ${where}: ${e.message}`;
}

// Read, advance, regenerate and optionally write back. Returns { ledgers, errors, status }.
// Bad now or holiday cells stop the run with the ledgers unchanged.
function runStorage(storage, nowText, options = {}) {
  const U = load();
  const errors = [];
  const ledgers = storage.readLedgers();
  const now = U.parseDateTime(nowText ?? '');
  if (now === null) errors.push(`bad now "${nowText ?? ''}"`);
  const holidays = [];
  storage.readHolidays().forEach((text, i) => {
    if (text === null) return;
    const day = U.parseDay(text);
    if (day === null) errors.push(`holidays row ${i + 2}: bad date "${text}"`);
    else holidays.push(day);
  });
  if (errors.length) return { ledgers, errors, status: null };

  const rotations = Object.keys(ledgers).map((name) => {
    const rows = ledgers[name].map((cells, i) => (isBlankRow(cells) ? null : U.rowFromArray(cells, i + 2))).filter(Boolean);
    return { name, rows, snapshotAt: U.advance(rows, now) };
  });
  const result = U.regenerate({ rotations, holidays, links: storage.readLinks() });
  const out = {};
  result.rotations.forEach((r) => { out[r.name] = structuredClone(r.rows.map(U.rowToArray)); });
  result.errors.forEach((e) => errors.push(describeError(U, e)));
  if (options.write) {
    Object.keys(out).forEach((name) => storage.writeLedger(name, out[name]));
    storage.writeStatus(structuredClone(result.status));
  }
  return { ledgers: out, errors, status: structuredClone(result.status) };
}

function runDir(dir, nowText, options = {}) {
  const storage = new CsvDirStorage(dir);
  return runStorage(storage, nowText ?? storage.readNow(), options);
}

function parseArgs(argv) {
  const args = { dir: null, now: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--now') args.now = argv[++i];
    else if (a === '--write') args.write = true;
    else throw new Error(`unknown argument "${a}"`);
  }
  if (!args.dir) throw new Error('usage: node node/cli.js --dir DIR [--now YYYY-MM-DDTHH:MM] [--write]');
  return args;
}

function main(argv) {
  let result;
  try {
    const args = parseArgs(argv);
    result = runDir(args.dir, args.now, { write: args.write });
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }
  Object.keys(result.ledgers).forEach((name) => {
    process.stdout.write(`# ${name}\n` + ledgerCsv(result.ledgers[name]));
  });
  result.errors.forEach((e) => process.stderr.write(e + '\n'));
  return result.errors.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runStorage, runDir, ledgerCsv };
