'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();
const { runStorage } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const MON = dt('2026-10-05T09:00');

const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const rotRows = (out, name) => out.rotations.find((r) => r.name === name).rows;
const shiftsOf = (out, name) => plain(rotRows(out, name).filter((r) => r.type === 'shift').map((r) => [U.formatDateTime(r.start), r.what, r.note]));
const whoOf = (out, name) => shiftsOf(out, name).map((s) => s[1]);
const BASE = 'tolerance=0, skip_weekends=false, skip_holidays=false, autopin=a:0';
const set = (start, what) => R('', start, 'set', what + ', ' + BASE);
const rotation = (name, setWhat, team, extra = []) => ({ name, rows: rows([set('2026-10-05T09:00', setWhat), R('', '2026-10-05T09:00', 'team', team), ...extra]), snapshotAt: MON });
const REL = (type, start, what, end, duration) => R('', start, type, what, end, duration);
const regen = (rotations, global = []) => U.regenerate({ rotations, holidays: [], global: rows(global), now: MON });
const ABCD = 'alice, bob, carol, dave';

// Relaxation warnings of a rotation per shift start, joined like the former notes; the note cell itself is empty.
const notesOf = (out, name) => shiftsOf(out, name).map((s) => plain(out.status.warnings.filter((w) => w.rotation === name && U.formatDateTime(w.start) === s[0]).map((w) => w.message)).join('; '));

test('repel! is a row type, epoch-capable, validated like repel and shown as -! in the relations matrix', () => {
  assert.equal(U.ROW_TYPES['repel!'].what, 'names');
  assert.ok(U.EPOCH_TYPES.indexOf('repel!') >= 0);
  const parsed = U.parseGlobal(rows([REL('repel!', '2026-10-05T09:00', 'a, b'), REL('repel!', '2026-10-05T09:00', 'a'), R('', '', 'repel!', 'a, b')]), ['a', 'b']);
  assert.deepEqual(plain(parsed.errors.map((e) => e.message)), ['repel! in #Global needs at least two rotations']);
  assert.deepEqual(plain(parsed.relationRows.map((r) => [r.type, r.start])), [['repel!', -Infinity], ['repel!', MON]]);
  const out = regen([rotation('a', 'period=1w, horizon=2w, min_distance=0', ABCD), rotation('b', 'period=1w, horizon=2w, min_distance=0', ABCD)], [REL('repel!', '2026-10-05T09:00', 'a, b')]);
  assert.deepEqual(plain(out.status.relations.map((r) => [r.reader, r.target, r.kind])), [['a', 'b', 'repel!'], ['b', 'a', 'repel!']]);
  const matrix = U.statusRows(out.status).rows.find((r) => r[0] === 'a' && r[1] === '' && r[2] === '-!');
  assert.ok(matrix, 'matrix row a shows -! for b');
});

test('window from two min_distance values in their own units: daily reads weekly, D = (2d + 2w) / 2 = 8d', () => {
  // alerts: weekly, four members, 0.5ts = 2w. backup: daily, 2sl = 2d. backup reads alerts with repel!.
  const alerts = rotation('alerts', 'period=1w, horizon=4w, min_distance=0.5ts', ABCD);
  const backup = { name: 'backup', rows: rows([set('2026-10-05T09:00', 'period=1d, horizon=3w, min_distance=2sl'), R('', '2026-10-05T09:00', 'team', ABCD), REL('repel!', '2026-10-05T09:00', 'alerts')]), snapshotAt: MON };
  const out = regen([alerts, backup]);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(whoOf(out, 'alerts'), ['alice', 'bob', 'carol', 'dave']);
  const daily = shiftsOf(out, 'backup');
  // alice holds alerts 10-05 to 10-12: kept off backup while [a - 8d, a + 1d + 8d) overlaps it, i.e. up to 10-19,
  // unless the two-day local rest leaves nobody else and the window has to shrink (noted on the shift).
  const notes = notesOf(out, 'backup');
  assert.ok(daily.every((s) => s[2] === ''), 'generated notes stay empty');
  const unrelaxed = daily.filter((s, i) => notes[i] === '');
  assert.ok(unrelaxed.filter((s) => s[1] === 'alice').every((s) => s[0] >= '2026-10-20'), 'alice off backup until 10-20');
  assert.ok(daily.some((s, i) => s[1] === 'alice' && s[0].startsWith('2026-10-20') && notes[i] === ''));
  // bob's alerts week 10-12 is decided at 10-12, so backup avoids him from 10-12 until 10-26 the same way.
  assert.ok(unrelaxed.filter((s) => s[1] === 'bob').every((s) => s[0] < '2026-10-12' || s[0] >= '2026-10-27'), 'bob off backup 10-12 to 10-26');
  // On 10-14 carol and dave are within their local rest and alice, bob are in the window: it shrinks to 2sl,
  // which is 2 days here, until alice's week no longer overlaps.
  const oct14 = daily.findIndex((s) => s[0].startsWith('2026-10-14'));
  assert.deepEqual([daily[oct14][1], notes[oct14]], ['alice', 'repel! relaxed to 2sl']);
  assert.ok(notes.filter((n) => n !== '').every((n) => /^repel! relaxed to \d+sl$/.test(n)));
  // The same rows with plain repel only exclude the overlapping week.
  const plainRows = { ...backup, rows: rows([set('2026-10-05T09:00', 'period=1d, horizon=3w, min_distance=2sl'), R('', '2026-10-05T09:00', 'team', ABCD), REL('repel', '2026-10-05T09:00', 'alerts')]) };
  const weak = regen([alerts, plainRows]);
  assert.ok(shiftsOf(weak, 'backup').some((s) => s[1] === 'alice' && s[0] >= '2026-10-12' && s[0] < '2026-10-19'));
});

test('one-sided repel! leaves the other rotation untouched; mutual applies the same window to both sides', () => {
  const primary = (extra = []) => rotation('primary', 'period=1w, horizon=4w, min_distance=1sl', 'alice, bob, carol', extra);
  const secondary = (extra = []) => rotation('secondary', 'period=1w, horizon=4w, min_distance=1sl', 'alice, bob, carol', extra);
  const alone = regen([primary(), secondary()]);
  const oneSided = regen([primary(), secondary([REL('repel!', '2026-10-05T09:00', 'primary')])]);
  assert.deepEqual(whoOf(oneSided, 'primary'), whoOf(alone, 'primary'));
  // D = (1w + 1w) / 2 = 1w: a primary holder is off secondary the week before, during and after.
  const p = shiftsOf(oneSided, 'primary'), s = shiftsOf(oneSided, 'secondary');
  s.forEach((slot, i) => {
    const near = p.filter((_, j) => Math.abs(j - i) <= 1 && j <= i).map((x) => x[1]);
    assert.ok(near.indexOf(slot[1]) < 0 || slot[2] !== '', slot.join(' '));
  });
  const mutual = regen([primary(), secondary()], [REL('repel!', '2026-10-05T09:00', 'primary, secondary')]);
  assert.notDeepEqual(whoOf(mutual, 'primary'), whoOf(alone, 'primary'));
  assert.deepEqual(plain(mutual.status.relations.map((r) => r.kind)), ['repel!', 'repel!']);
});

test('relaxation order: repel! window first, then min_distance, then repel dropped, with the note texts', () => {
  const primary = rotation('primary', 'period=1w, horizon=3w, min_distance=0', 'alice, bob');
  // secondary reads primary; D = (2w + 0) / 2 = 1w; its own min_distance 2sl.
  const secondary = rotation('secondary', 'period=1w, horizon=3w, min_distance=2sl', 'alice, bob', [REL('repel!', '2026-10-05T09:00', 'primary')]);
  const out = regen([primary, secondary]);
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'bob', 'alice']);
  assert.deepEqual(shiftsOf(out, 'secondary'), [
    ['2026-10-05T09:00', 'bob', ''],
    ['2026-10-12T09:00', 'alice', ''],
    ['2026-10-19T09:00', 'bob', ''],
  ]);
  assert.deepEqual(notesOf(out, 'secondary'), ['', 'repel! relaxed to 0', 'repel! relaxed to 0; min_distance relaxed to 1sl']);
  // With alice alone in secondary (rest 2sl, so D = 1w) every stage shows up: the window goes first, then the
  // local rest, and where alice also holds primary the repel itself is dropped last.
  const lone = rotation('secondary', 'period=1w, horizon=3w, min_distance=2sl', 'alice', [REL('repel!', '2026-10-05T09:00', 'primary')]);
  const dropped = regen([primary, lone]);
  assert.deepEqual(notesOf(dropped, 'secondary'), [
    'repel! relaxed to 0; repel relaxed: alice also on primary',
    'repel! relaxed to 0; min_distance relaxed to 0',
    'repel! relaxed to 0; min_distance relaxed to 0; repel relaxed: alice also on primary',
  ]);
  assert.deepEqual(plain(dropped.status.warnings.map((w) => w.message)).slice(0, 2), ['repel! relaxed to 0', 'repel relaxed: alice also on primary']);
  // The window note only appears when the chosen member was inside the window: with zed alone on primary the
  // window never excluded alice, so only her own rest is reported.
  const zed = rotation('primary', 'period=1w, horizon=3w, min_distance=0', 'zed');
  const untouched = regen([zed, lone]);
  assert.deepEqual(notesOf(untouched, 'secondary'), ['', 'min_distance relaxed to 0', 'min_distance relaxed to 0']);
  assert.ok(untouched.status.warnings.every((w) => !/repel!/.test(w.message)));
});

test('repel -> repel! -> detach flips the pair state; a repel! row replaces repel and vice versa', () => {
  const rel = new U.Relations();
  const entry = (type, start, names, reader = null) => ({ row: U.makeRow({ type, start: dt(start), what: names.join(', ') }), reader, names });
  rel.add(entry('repel', '2026-10-05T09:00', ['a', 'b']));
  rel.add(entry('repel!', '2026-10-12T09:00', ['a', 'b']));
  rel.add(entry('detach', '2026-10-19T09:00', ['a', 'b']));
  rel.add(entry('repel!', '2026-10-26T09:00', ['b'], 'a'));
  rel.add(entry('repel', '2026-11-02T09:00', ['a', 'b']));
  assert.equal(rel.kindFor('a', 'b', dt('2026-10-05T09:00')), 'repel');
  assert.equal(rel.kindFor('a', 'b', dt('2026-10-12T09:00')), 'repel!');
  assert.equal(rel.kindFor('b', 'a', dt('2026-10-12T09:00')), 'repel!');
  assert.equal(rel.kindFor('a', 'b', dt('2026-10-19T09:00')), null);
  assert.equal(rel.kindFor('a', 'b', dt('2026-10-26T09:00')), 'repel!');
  assert.equal(rel.kindFor('b', 'a', dt('2026-10-26T09:00')), null);
  assert.equal(rel.kindFor('a', 'b', dt('2026-11-02T09:00')), 'repel');
  assert.deepEqual(plain(rel.orderEdges(dt('2026-10-26T09:00')).map((e) => [e.from, e.to])), [['b', 'a']]);
});

test('idempotence and full replay with repel! through the runner', () => {
  const ledgers = {
    primary: [set('2026-10-05T09:00', 'period=1w, horizon=4w, min_distance=1sl'), R('', '2026-10-05T09:00', 'team', 'alice, bob, carol')],
    secondary: [set('2026-10-05T09:00', 'period=1w, horizon=4w, min_distance=1sl'), R('', '2026-10-05T09:00', 'team', 'alice, bob, carol')],
  };
  const global = [REL('repel!', '2026-10-05T09:00', 'primary, secondary')];
  const storage = new MemoryStorage({ ledgers, global });
  const first = runStorage(storage, '2026-10-13T10:00', { write: true });
  assert.deepEqual(first.errors, []);
  const again = runStorage(new MemoryStorage({ ledgers: storage.ledgers, global }), '2026-10-13T10:00', { write: true });
  assert.deepEqual(again.ledgers, first.ledgers);
  const stripped = {};
  Object.keys(storage.ledgers).forEach((n) => { stripped[n] = storage.ledgers[n].filter((c) => c[2] !== 'snapshot'); });
  const replayed = runStorage(new MemoryStorage({ ledgers: stripped, global }), '2026-10-13T10:00', { write: true });
  assert.deepEqual(replayed.ledgers, first.ledgers);
  assert.deepEqual(first.global.map((c) => c[2]), ['repel!']);
});
