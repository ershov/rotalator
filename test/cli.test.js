'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initDir, runDir } = require('../node/cli.js');
const U = require('../node/load.js').load();

const TMP = path.join(__dirname, '..', '.tmp', 'cli-test');

function fresh(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}

test('init: template ledger, holidays and now; start defaults to the recent Monday', () => {
  const dir = fresh('plain');
  const out = initDir(dir, { rotation: 'primary', now: '2026-10-07T12:00' });
  assert.deepEqual(out.files.map((f) => path.basename(f)), ['primary.csv', 'holidays.csv', 'now.txt']);
  assert.equal(out.start, '2026-10-05');
  const rows = U.parseCsv(fs.readFileSync(path.join(dir, 'primary.csv'), 'utf8'));
  assert.deepEqual(structuredClone(rows), structuredClone(U.templateRows(U.parseDateTime('2026-10-05'))));
  assert.equal(fs.readFileSync(path.join(dir, 'holidays.csv'), 'utf8'), 'date,note\n2025-01-01,New Year\n');
  assert.equal(fs.readFileSync(path.join(dir, 'now.txt'), 'utf8'), '2026-10-07T12:00\n');
  const result = runDir(dir);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ledgers.primary.filter((r) => r[2] === 'shift').length, 13);
  assert.throws(() => initDir(dir, { rotation: 'primary', now: '2026-10-07T12:00' }), /already exists/);
  const named = initDir(fresh('default-name'), { now: '2026-10-07T12:00' });
  assert.equal(path.basename(named.files[0]), 'Rotation 1 Primary.csv');
});

test('init: history-from dates the set row at the first boundary and adds empty shifts up to start', () => {
  const dir = fresh('history');
  const out = initDir(dir, { rotation: 'ops', start: '2026-10-05T09:00', historyFrom: '2026-09-10', now: '2026-10-07T12:00' });
  assert.equal(out.start, '2026-09-14T09:00');
  const rows = U.parseCsv(fs.readFileSync(path.join(dir, 'ops.csv'), 'utf8')).slice(1).filter((r) => r[2] !== '');
  assert.deepEqual(structuredClone(rows.map((r) => [r[1], r[2], r[3]])), [
    ['2026-09-14T09:00', 'set', rows[0][3]],
    ['2026-09-14T09:00', 'team', 'alice, bob, carol'],
    ['2026-09-14T09:00', 'shift', ''],
    ['2026-09-21T09:00', 'shift', ''],
    ['2026-09-28T09:00', 'shift', ''],
  ]);
  assert.deepEqual(runDir(dir).errors, []);
  assert.throws(() => initDir(fresh('bad'), { rotation: 'ops', start: '2026-10-05T09:00', historyFrom: '2026-10-06', now: '2026-10-07T12:00' }), /before the start/);
  assert.throws(() => initDir(fresh('bad'), { rotation: '#ops', now: '2026-10-07T12:00' }), /bad rotation name/);
});
