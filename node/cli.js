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
