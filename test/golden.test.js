'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runDir, runStorage, ledgerCsv } = require('../node/cli.js');
const { CsvDirStorage, MemoryStorage } = require('../node/storage.js');

const FIXTURES = path.join(__dirname, 'fixtures');

// Each fixture: inputs, expected/<rotation>.csv per ledger, optional expected/errors.txt.
// A second run on the output with the same now must reproduce it exactly.
for (const name of fs.readdirSync(FIXTURES).sort()) {
  const dir = path.join(FIXTURES, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  test(`golden ${name}`, () => {
    const storage = new CsvDirStorage(dir);
    const nowText = storage.readNow();
    const result = runDir(dir, nowText);
    const expected = fs.readdirSync(path.join(dir, 'expected')).filter((f) => f.endsWith('.csv')).map((f) => f.slice(0, -4)).sort();
    assert.deepEqual(Object.keys(result.ledgers).sort(), expected);
    for (const rotation of expected) {
      assert.equal(ledgerCsv(result.ledgers[rotation]), fs.readFileSync(path.join(dir, 'expected', `${rotation}.csv`), 'utf8'), rotation);
    }
    const errorsFile = path.join(dir, 'expected', 'errors.txt');
    const expectedErrors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.deepEqual(result.errors, expectedErrors);

    const again = runStorage(new MemoryStorage({ ledgers: result.ledgers, holidays: storage.readHolidays(), links: storage.readLinks() }), nowText);
    for (const rotation of expected) {
      assert.equal(ledgerCsv(again.ledgers[rotation]), ledgerCsv(result.ledgers[rotation]), `${rotation} second run`);
    }
    // Row numbers move once error rows are inserted, so compare messages without them.
    const withoutRow = (e) => e.replace(/ row \d+:/, ':');
    assert.deepEqual(again.errors.map(withoutRow), expectedErrors.map(withoutRow));
  });
}
