'use strict';
const { load } = require('./load.js');
const { CsvDirStorage } = require('./storage.js');

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
  return textTable(U.statusRows(status)) + '\n' + textTable(U.shiftsRows(status.shifts));
}

function runDir(dir, nowText, options = {}) {
  const storage = new CsvDirStorage(dir);
  return runStorage(storage, nowText ?? storage.readNow(), options);
}

function parseArgs(argv) {
  const args = { dir: null, now: null, write: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--now') args.now = argv[++i];
    else if (a === '--write') args.write = true;
    else if (a === '--status') args.status = true;
    else throw new Error(`unknown argument "${a}"`);
  }
  if (!args.dir) throw new Error('usage: node node/cli.js --dir DIR [--now YYYY-MM-DDTHH:MM] [--write] [--status]');
  return args;
}

function main(argv) {
  let result, args;
  try {
    args = parseArgs(argv);
    result = runDir(args.dir, args.now, { write: args.write });
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }
  Object.keys(result.ledgers).forEach((name) => {
    process.stdout.write(`# ${name}\n` + ledgerCsv(result.ledgers[name]));
  });
  if (result.links) process.stdout.write('# Links\n' + ledgerCsv(result.links));
  if (args.status && result.status) process.stdout.write('\n' + statusText(result.status));
  result.errors.forEach((e) => process.stderr.write(e + '\n'));
  return result.errors.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runStorage, runDir, ledgerCsv, statusText };
