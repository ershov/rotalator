'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runDir, runStorage, ledgerCsv, statusText } = require('../node/cli.js');
const { CsvDirStorage, MemoryStorage } = require('../node/storage.js');

const FIXTURES = path.join(__dirname, 'fixtures');

test('CsvDirStorage: # files and files without the ledger header are ignored and reported', () => {
  const storage = new CsvDirStorage(path.join(FIXTURES, 'disabled-rotation'));
  assert.deepEqual(Object.keys(storage.readLedgers()), ['primary']);
  assert.deepEqual(storage.ignoredTabs(), ['#secondary', 'Notes']);
  assert.equal(storage.readLinks().length, 1);
  const first = runDir(path.join(FIXTURES, 'disabled-rotation'), '2026-09-08T10:00');
  assert.deepEqual(first.status.tabs, { rotations: ['primary'], holidays: 2, links: 1, ignored: ['#secondary', 'Notes'] });
  // The written #Links carries an error row, which must not count as a link row on the next run.
  const again = runStorage(new MemoryStorage({ ledgers: first.ledgers, holidays: storage.readHolidays(), links: first.links }), '2026-09-08T10:00');
  assert.equal(again.status.tabs.links, 1);
});

// Each fixture: inputs, expected/<rotation>.csv per ledger, optional expected/links.csv, errors.txt and status.txt.
// A second run on the output with the same now must reproduce it exactly.
for (const name of fs.readdirSync(FIXTURES).sort()) {
  const dir = path.join(FIXTURES, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  test(`golden ${name}`, () => {
    const storage = new CsvDirStorage(dir);
    const nowText = storage.readNow();
    const result = runDir(dir, nowText);
    const expected = fs.readdirSync(path.join(dir, 'expected')).filter((f) => f.endsWith('.csv') && f !== 'links.csv').map((f) => f.slice(0, -4)).sort();
    assert.deepEqual(Object.keys(result.ledgers).sort(), expected);
    for (const rotation of expected) {
      assert.equal(ledgerCsv(result.ledgers[rotation]), fs.readFileSync(path.join(dir, 'expected', `${rotation}.csv`), 'utf8'), rotation);
    }
    const linksFile = path.join(dir, 'expected', 'links.csv');
    assert.equal(result.links !== null, fs.existsSync(linksFile), 'links present');
    if (result.links) assert.equal(ledgerCsv(result.links), fs.readFileSync(linksFile, 'utf8'), 'links');
    const errorsFile = path.join(dir, 'expected', 'errors.txt');
    const expectedErrors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.deepEqual(result.errors, expectedErrors);
    const statusFile = path.join(dir, 'expected', 'status.txt');
    if (fs.existsSync(statusFile)) assert.equal(statusText(result.status), fs.readFileSync(statusFile, 'utf8'));

    const again = runStorage(new MemoryStorage({ ledgers: result.ledgers, holidays: storage.readHolidays(), links: result.links ?? [] }), nowText);
    if (result.links) assert.equal(ledgerCsv(again.links), ledgerCsv(result.links), 'links second run');
    for (const rotation of expected) {
      assert.equal(ledgerCsv(again.ledgers[rotation]), ledgerCsv(result.ledgers[rotation]), `${rotation} second run`);
    }
    // Row numbers move once error rows are inserted, so compare messages without them.
    const withoutRow = (e) => e.replace(/ row \d+:/, ':');
    assert.deepEqual(again.errors.map(withoutRow), expectedErrors.map(withoutRow));
  });
}
