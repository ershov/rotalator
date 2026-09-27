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
  assert.equal(storage.readGlobal().length, 1);
  const first = runDir(path.join(FIXTURES, 'disabled-rotation'), '2026-09-08T10:00');
  assert.deepEqual(first.status.tabs, { rotations: ['primary'], regenerated: ['primary'], holidays: 2, global: 1, ignored: ['#secondary', 'Notes'] });
  // The written #Global carries an error row, which must not count as a row on the next run.
  const again = runStorage(new MemoryStorage({ ledgers: first.ledgers, holidays: storage.readHolidays(), global: first.global }), '2026-09-08T10:00');
  assert.equal(again.status.tabs.global, 1);
});

test('runner: rotations option writes only the named ledgers and reports unknown names', () => {
  const dir = path.join(FIXTURES, 'repel-global');
  const storage = new CsvDirStorage(dir);
  const before = storage.readLedgers();
  const mem = new MemoryStorage({ ledgers: before, holidays: storage.readHolidays(), global: storage.readGlobal() });
  const result = runStorage(mem, storage.readNow(), { write: true, rotations: ['secondary'] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result.ledgers), ['secondary']);
  assert.deepEqual(mem.ledgers.primary, before.primary, 'primary untouched');
  assert.equal(ledgerCsv(mem.ledgers.secondary), fs.readFileSync(path.join(dir, 'expected', 'secondary.csv'), 'utf8'));
  assert.deepEqual(result.status.tabs.rotations, ['primary', 'secondary']);
  assert.deepEqual(result.status.tabs.regenerated, ['secondary']);
  assert.ok(mem.status !== null && mem.global !== null);
  const bad = new MemoryStorage({ ledgers: before, holidays: storage.readHolidays(), global: storage.readGlobal() });
  const failed = runStorage(bad, storage.readNow(), { write: true, rotations: ['secondary', 'tertiary'] });
  assert.deepEqual(failed.errors, ['unknown rotation "tertiary"']);
  assert.equal(failed.status, null);
  assert.equal(bad.status, null);
  assert.deepEqual(bad.ledgers, before);
});

// Each fixture: inputs, expected/<rotation>.csv per ledger, optional expected/global.csv, errors.txt and status.txt.
// A second run on the output with the same now must reproduce it exactly.
for (const name of fs.readdirSync(FIXTURES).sort()) {
  const dir = path.join(FIXTURES, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  test(`golden ${name}`, () => {
    const storage = new CsvDirStorage(dir);
    const nowText = storage.readNow();
    const result = runDir(dir, nowText);
    const expected = fs.readdirSync(path.join(dir, 'expected')).filter((f) => f.endsWith('.csv') && f !== 'global.csv').map((f) => f.slice(0, -4)).sort();
    assert.deepEqual(Object.keys(result.ledgers).sort(), expected);
    for (const rotation of expected) {
      assert.equal(ledgerCsv(result.ledgers[rotation]), fs.readFileSync(path.join(dir, 'expected', `${rotation}.csv`), 'utf8'), rotation);
    }
    const globalFile = path.join(dir, 'expected', 'global.csv');
    assert.equal(result.global !== null, fs.existsSync(globalFile), 'global present');
    if (result.global) assert.equal(ledgerCsv(result.global), fs.readFileSync(globalFile, 'utf8'), 'global');
    const errorsFile = path.join(dir, 'expected', 'errors.txt');
    const expectedErrors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    assert.deepEqual(result.errors, expectedErrors);
    const statusFile = path.join(dir, 'expected', 'status.txt');
    if (fs.existsSync(statusFile)) assert.equal(statusText(result.status), fs.readFileSync(statusFile, 'utf8'));

    // Extension tabs travel along: a gcal.csv loads the GCal extension, which reads #GCal on the second run too.
    const tabs = { '#GCal': storage.readTabRows('#GCal', ['preset', 'setting', 'value']) };
    const again = runStorage(new MemoryStorage({ ledgers: result.ledgers, holidays: storage.readHolidays(), global: result.global ?? [], tabs }), nowText);
    if (result.global) assert.equal(ledgerCsv(again.global), ledgerCsv(result.global), 'global second run');
    for (const rotation of expected) {
      assert.equal(ledgerCsv(again.ledgers[rotation]), ledgerCsv(result.ledgers[rotation]), `${rotation} second run`);
    }
    // Row numbers move once error rows are inserted, so compare messages without them.
    const withoutRow = (e) => e.replace(/ row \d+:/, ':');
    assert.deepEqual(again.errors.map(withoutRow), expectedErrors.map(withoutRow));
  });
}
