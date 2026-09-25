'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();
const { runStorage } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));

const BASE = 'period=1w, horizon=6w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false';
const SET = (extra = 'autopin=a:0') => R('', '2026-10-05T09:00', 'set', BASE + (extra ? ', ' + extra : ''));
const TEAM = R('', '2026-10-05T09:00', 'team', 'alice, bob, carol');
// Three past shifts, the current one at 10-26 and generated ones after it.
const HISTORY = [
  R('', '2026-10-05T09:00', 'shift', 'alice'), R('', '2026-10-12T09:00', 'shift', 'bob'), R('', '2026-10-19T09:00', 'shift', 'carol'),
  R('x', '2026-11-16T09:00', 'shift', 'carol', '', '', 'volunteered'),
];
const NOW = '2026-10-28T10:00';

function run(cells, now = NOW, global = []) {
  const ledger = rows(cells);
  const S = U.advance(ledger, dt(now), new Set(), rows(global).filter((r) => r.type === 'set'));
  return U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: S }], holidays: [], global: rows(global), now: dt(now) });
}
const cellsOf = (out) => plain(out.rotations[0].rows.map(U.rowToArray));
const pins = (out) => cellsOf(out).filter((c) => c[2] === 'shift').map((c) => [c[1], c[0]]);

test('default autopin 0 pins past shifts and the current one, not the future; other cells untouched', () => {
  const out = run([SET(), TEAM, ...HISTORY]);
  assert.deepEqual(pins(out), [
    ['2026-10-05T09:00', 'a'], ['2026-10-12T09:00', 'a'], ['2026-10-19T09:00', 'a'], ['2026-10-26T09:00', 'a'],
    ['2026-11-02T09:00', ''], ['2026-11-09T09:00', ''], ['2026-11-16T09:00', 'x'], ['2026-11-23T09:00', ''], ['2026-11-30T09:00', ''],
  ]);
  const unpinned = run([SET('autopin=false'), TEAM, ...HISTORY]);
  const shiftsWithout = (o) => cellsOf(o).filter((c) => c[2] === 'shift').map((c) => c.slice(1));
  assert.deepEqual(shiftsWithout(out), shiftsWithout(unpinned), 'only the pin column differs');
  assert.equal(out.status.rotations[0].settings.values.find((v) => v.key === 'autopin').value, 'a:0');
});

test('autopin=false pins nothing; existing pins are kept whatever the value', () => {
  const out = run([SET('autopin=false'), TEAM, ...HISTORY]);
  assert.deepEqual(pins(out).map((p) => p[1]), ['', '', '', '', '', '', 'x', '', '']);
  const marked = run([SET('autopin=keep:8w'), TEAM, ...HISTORY]);
  assert.deepEqual(pins(marked).map((p) => p[1]), ['keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'x', 'keep', 'keep']);
});

test('autopin=2w pins freshly generated shifts inside the window; -2w only older ones', () => {
  const ahead = run([SET('autopin=2w'), TEAM, ...HISTORY]);
  assert.deepEqual(pins(ahead), [
    ['2026-10-05T09:00', 'a'], ['2026-10-12T09:00', 'a'], ['2026-10-19T09:00', 'a'], ['2026-10-26T09:00', 'a'],
    ['2026-11-02T09:00', 'a'], ['2026-11-09T09:00', 'a'], ['2026-11-16T09:00', 'x'], ['2026-11-23T09:00', ''], ['2026-11-30T09:00', ''],
  ]);
  const behind = run([SET('autopin=-2w'), TEAM, ...HISTORY]);
  assert.deepEqual(pins(behind).map((p) => p[1]), ['a', 'a', '', '', '', '', 'x', '', '']);
});

test('grid units resolve at now with the roster size: 1ts is three weeks for three members', () => {
  const out = run([SET('autopin=1ts'), TEAM, ...HISTORY]);
  assert.deepEqual(pins(out).map((p) => p[1]), ['a', 'a', 'a', 'a', 'a', 'a', 'x', '', '']);
  const grown = run([SET('autopin=1ts'), R('', '2026-10-05T09:00', 'team', 'alice, bob, carol, dave, erin'), ...HISTORY]);
  assert.deepEqual(pins(grown).map((p) => p[1]).slice(4), ['a', 'a', 'x', 'a', 'a']);
  const half = run([SET('autopin=0.5sl'), TEAM, ...HISTORY]);
  assert.deepEqual(pins(half).map((p) => p[1]), ['a', 'a', 'a', 'a', '', '', 'x', '', '']);
});

test('autopin comes through #Global and is overridden locally', () => {
  const global = [R('', '2026-01-01', 'set', 'autopin=2w')];
  assert.deepEqual(pins(run([SET(''), TEAM, ...HISTORY], NOW, global)).map((p) => p[1]), ['a', 'a', 'a', 'a', 'a', 'a', 'x', '', '']);
  assert.deepEqual(pins(run([SET('autopin=false'), TEAM, ...HISTORY], NOW, global)).map((p) => p[1]), ['', '', '', '', '', '', 'x', '', '']);
  const out = run([SET(''), TEAM, ...HISTORY], NOW, global);
  assert.deepEqual(plain(out.status.rotations[0].settings.values.find((v) => v.key === 'autopin')), { key: 'autopin', value: '2w', source: 'global' });
});

test('idempotent: a second run with the same now changes nothing, pinned rows are kept and no longer regenerated', () => {
  const first = run([SET('autopin=2w'), TEAM, ...HISTORY]);
  const written = cellsOf(first);
  const second = run(written);
  assert.deepEqual(cellsOf(second), written);
  // A team change after the window reshapes only the future beyond it.
  const changed = run(written.concat([R('', '2026-10-29T09:00', 'team', 'carol, bob')]));
  assert.deepEqual(pins(changed).map((p) => p[1]), ['a', 'a', 'a', 'a', 'a', 'a', 'x', '', '']);
  assert.deepEqual(cellsOf(changed).filter((c) => c[2] === 'shift').slice(4, 6).map((c) => c[3]), ['bob', 'carol']);
});

test('no autopin without now, on frozen rotations or on the error path', () => {
  const ledger = rows([SET(), TEAM, ...HISTORY]);
  const noNow = U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: dt('2026-10-26T09:00') }], holidays: [], global: [] });
  assert.deepEqual(pins(noNow).map((p) => p[1]).filter(Boolean), ['x']);
  const other = { name: 'o', rows: rows([SET(), R('', '2026-10-05T09:00', 'team', 'dave')]), snapshotAt: dt('2026-10-26T09:00') };
  const scoped = U.regenerate({ rotations: [{ name: 'r', rows: ledger, snapshotAt: dt('2026-10-26T09:00') }, other], holidays: [], global: [], now: dt(NOW), only: ['o'] });
  assert.deepEqual(plain(scoped.rotations.map((r) => r.name)), ['o']);
  // The written rotation is backfilled from its first roster row and pinned up to now; the frozen one is not
  // returned at all.
  assert.deepEqual(plain(scoped.rotations[0].rows.filter((r) => r.type === 'shift').map((r) => r.pin)), ['a', 'a', 'a', 'a', '', '', '', '', '']);
  const broken = run([SET(), TEAM, ...HISTORY, R('', '2026-10-29T09:00', 'join', 'alice')]);
  assert.equal(broken.regenerated, false);
  assert.deepEqual(pins(broken).map((p) => p[1]).filter(Boolean), ['x']);
});

test('runner: pins land in the written ledger and in a dry run result', () => {
  const ledgers = { r: [SET(), TEAM, ...HISTORY] };
  const storage = new MemoryStorage({ ledgers });
  const result = runStorage(storage, NOW, { write: true });
  assert.deepEqual(storage.ledgers.r.filter((c) => c[2] === 'shift').map((c) => c[0]), ['a', 'a', 'a', 'a', '', '', 'x', '', '']);
  const dry = runStorage(new MemoryStorage({ ledgers }), NOW);
  assert.deepEqual(dry.ledgers.r, result.ledgers.r);
});
