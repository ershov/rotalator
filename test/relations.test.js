'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();
const { runStorage } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const MON = dt('2026-10-05T09:00');
const W = 7 * 1440;

const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (rowList) => plain(rowList.map(U.rowToArray));
const rotRows = (out, name) => out.rotations.find((r) => r.name === name).rows;
const shiftsOf = (out, name) => plain(rotRows(out, name).filter((r) => r.type === 'shift').map((r) => [U.formatDateTime(r.start), r.what, r.note]));
const whoOf = (out, name) => shiftsOf(out, name).map((s) => s[1]);
const errorsOf = (out, name) => plain(rotRows(out, name).filter((r) => r.type === 'error').map((r) => r.what));

const SET = R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w');
const rotation = (name, team, extra = []) => ({ name, rows: rows([SET, R('', '2026-10-05T09:00', 'team', team), ...extra]), snapshotAt: MON });
const REL = (type, start, what, end, duration) => R('', start, type, what, end, duration);
const regen = (rotations, global = [], only) => U.regenerate({ rotations, holidays: [], global: rows(global), only });
const ABC = 'alice, bob, carol';

test('parseGlobal: relation rows are validated, error rows sit above rejected rows, comments and sets kept', () => {
  const cells = [
    REL('repel', '2026-10-05T09:00', 'primary, secondary'),
    REL('attract', '2026-10-12T09:00', 'primary, secondary', '', '2w'),
    REL('detach', '2026-10-05T09:00', 'primary, secondary', '2026-10-19T09:00'),
    REL('repel', '2026-10-05T09:00', 'primary, tertiary'),
    REL('repel', '2026-10-05T09:00', 'primary'),
    REL('repel', '2026-10-05T09:00', 'primary, primary'),
    REL('repel', '2026-10-05T09:00', 'primary, bob=1'),
    R('', '2026-10-05T09:00', 'shift', 'alice'),
    R('', '2026-10-05T09:00', 'link', 'distinct: primary, secondary'),
    R('', 'soon', 'repel', 'primary, secondary'),
    REL('repel', '2026-10-05T09:00', 'primary, secondary', '2026-10-12T09:00', '1w'),
    R('', '2026-10-06T09:00', 'error', 'stale'),
    R('', '', '', 'a comment'),
    R('', '2026-10-05T09:00', 'set', 'tolerance=1'),
  ];
  const out = U.parseGlobal(rows(cells), ['primary', 'secondary']);
  assert.deepEqual(plain(out.relationRows.map((r) => [r.type, r.what])), [['repel', 'primary, secondary'], ['detach', 'primary, secondary'], ['attract', 'primary, secondary']]);
  assert.deepEqual(plain(out.setRows.map((r) => r.what)), ['tolerance=1']);
  assert.deepEqual(plain(out.errors.map((e) => [e.rowIndex, e.message])), [
    [5, 'unknown rotation "tertiary"'],
    [6, 'repel in #Global needs at least two rotations'],
    [7, 'repel names a rotation twice'],
    [8, 'repel takes names only, got "bob="'],
    [12, 'end and duration are mutually exclusive'],
    [9, 'type "shift" is not allowed in #Global'],
    [10, 'type "link" is not allowed in #Global'],
    [11, 'bad start "soon"'],
  ]);
  const written = cellsOf(out.rows);
  assert.equal(written.filter((c) => c[2] === 'error').length, 8);
  assert.equal(written[0][2], 'error');
  assert.equal(written[0][3], 'unknown rotation "tertiary"');
  // The undated comment attaches to the set row below it and stays right above it.
  assert.equal(written[written.findIndex((c) => c[3] === 'a comment') + 1][2], 'set');
  assert.deepEqual(written[written.length - 1].slice(1, 3), ['soon', 'repel']);
  assert.deepEqual(written[written.length - 2].slice(1, 4), ['soon', 'error', 'bad start "soon"']);
});

test('Relations: pair state over time, latest row wins, end reverts, detach clears, direction recorded', () => {
  const rel = new U.Relations();
  const entry = (type, start, names, reader = null, end) => ({ row: U.makeRow({ type, start: dt(start), end: end ? dt(end) : null, what: names.join(', ') }), reader, names });
  rel.add(entry('repel', '2026-10-05T09:00', ['a', 'b', 'c']));
  rel.add(entry('attract', '2026-10-12T09:00', ['a', 'b'], null, '2026-10-19T09:00'));
  rel.add(entry('detach', '2026-10-26T09:00', ['b', 'c']));
  rel.add(entry('attract', '2026-11-02T09:00', ['c'], 'a'));
  const state = (x, y, t) => { const s = rel.stateAt(x, y, dt(t)); return s ? [s.kind, s.reader] : null; };
  assert.equal(state('a', 'b', '2026-10-05T08:59'), null);
  assert.deepEqual(state('a', 'b', '2026-10-05T09:00'), ['repel', null]);
  assert.deepEqual(state('b', 'a', '2026-10-12T09:00'), ['attract', null]);
  assert.equal(state('a', 'b', '2026-10-19T09:00'), null);
  assert.deepEqual(state('a', 'c', '2026-10-19T09:00'), ['repel', null]);
  assert.deepEqual(state('b', 'c', '2026-10-25T09:00'), ['repel', null]);
  assert.equal(state('b', 'c', '2026-10-26T09:00'), null);
  assert.deepEqual(state('c', 'a', '2026-11-02T09:00'), ['attract', 'a']);
  assert.equal(rel.kindFor('a', 'c', dt('2026-11-02T09:00')), 'attract');
  assert.equal(rel.kindFor('c', 'a', dt('2026-11-02T09:00')), null);
  assert.equal(rel.kindFor('a', 'c', dt('2026-10-20T09:00')), 'repel');
  assert.equal(rel.kindFor('c', 'a', dt('2026-10-20T09:00')), 'repel');
  // Same instant: an end sorts before a start, and the later-added row wins among starts.
  const same = new U.Relations();
  same.add(entry('repel', '2026-10-05T09:00', ['a', 'b'], null, '2026-10-12T09:00'));
  same.add(entry('attract', '2026-10-12T09:00', ['a', 'b']));
  assert.deepEqual(state.call(null, 'a', 'b', '2026-10-12T09:00') && [same.stateAt('a', 'b', dt('2026-10-12T09:00')).kind], ['attract']);
  same.add(entry('repel', '2026-10-12T09:00', ['a'], 'b'));
  assert.deepEqual([same.stateAt('a', 'b', dt('2026-10-12T09:00')).kind, same.stateAt('a', 'b', dt('2026-10-12T09:00')).reader], ['repel', 'b']);
  // Two tabs starting the same one-sided relation on each other at one instant make the pair mutual.
  const mutual = new U.Relations();
  mutual.add(entry('repel', '2026-10-05T09:00', ['b'], 'a'));
  mutual.add(entry('repel', '2026-10-05T09:00', ['a'], 'b'));
  assert.deepEqual([mutual.stateAt('a', 'b', MON).kind, mutual.stateAt('a', 'b', MON).reader], ['repel', null]);
  assert.deepEqual([mutual.kindFor('a', 'b', MON), mutual.kindFor('b', 'a', MON)], ['repel', 'repel']);
  assert.deepEqual(plain(mutual.orderEdges(MON)), []);
  // With different kinds the later-processed row wins as usual.
  const mixed = new U.Relations();
  mixed.add(entry('repel', '2026-10-05T09:00', ['b'], 'a'));
  mixed.add(entry('attract', '2026-10-05T09:00', ['a'], 'b'));
  assert.deepEqual([mixed.stateAt('a', 'b', MON).kind, mixed.stateAt('a', 'b', MON).reader], ['attract', 'b']);
});

test('relationOrder: readers after their targets, mutual rows add no edges, tab order otherwise, cycles reported', () => {
  const entry = (type, start, names, reader = null, end) => ({ row: U.makeRow({ type, start: dt(start), end: end ? dt(end) : null, what: names.join(', ') }), reader, names });
  const names = ['a', 'b', 'c', 'd'];
  const edgesOf = (entries, t = MON) => { const rel = new U.Relations(); entries.forEach((e) => rel.add(e)); return rel.orderEdges(t); };
  // A mutual row orders nothing; a reads d, so a comes after d; b and c keep their tab positions.
  let out = U.relationOrder(edgesOf([entry('repel', '2026-10-05T09:00', ['c', 'a']), entry('attract', '2026-10-05T09:00', ['d'], 'a')]), names);
  assert.deepEqual(plain(out.order), ['b', 'c', 'd', 'a']);
  assert.deepEqual(plain(out.ignored), []);
  out = U.relationOrder(edgesOf([entry('detach', '2026-10-05T09:00', ['b'], 'a')]), names);
  assert.deepEqual(plain(out.order), ['a', 'b', 'c', 'd']);
  const cycle = [entry('repel', '2026-10-05T09:00', ['b'], 'a'), entry('repel', '2026-10-12T09:00', ['a'], 'b'), entry('repel', '2026-10-05T09:00', ['a'], 'c')];
  out = U.relationOrder(edgesOf(cycle), names);
  assert.deepEqual(plain(out.cyclic), ['a', 'b']);
  assert.deepEqual(plain(out.ignored.map((e) => e.reader)), ['a', 'b']);
  assert.deepEqual(plain(out.order), ['a', 'b', 'c', 'd']);
  assert.equal(U.cycleMessage(cycle[0], out.cyclic), 'relation order cycle among b; use a #Global row');
  // Only states in force at or after t count: an ended or superseded row orders nothing.
  const ended = [entry('repel', '2025-01-06T09:00', ['b'], 'a', '2025-06-01T09:00'), entry('repel', '2026-10-05T09:00', ['a'], 'b')];
  assert.deepEqual(plain(edgesOf(ended).map((e) => [e.from, e.to])), [['a', 'b']]);
  const superseded = [entry('repel', '2025-01-06T09:00', ['b'], 'a'), entry('repel', '2026-10-05T09:00', ['a'], 'b')];
  assert.deepEqual(plain(edgesOf(superseded).map((e) => [e.from, e.to])), [['a', 'b']]);
  assert.deepEqual(plain(edgesOf(superseded, dt('2025-03-01')).map((e) => [e.from, e.to])), [['b', 'a'], ['a', 'b']]);
});

test('repel in #Global: the same member never holds overlapping shifts in both rotations', () => {
  const rotations = [rotation('primary', ABC), rotation('secondary', ABC)];
  assert.deepEqual(whoOf(regen(rotations), 'secondary'), ['alice', 'bob', 'carol']);
  const out = regen(rotations, [REL('repel', '2026-10-05T09:00', 'primary, secondary')]);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'secondary'), ['bob', 'carol', 'alice']);
  assert.deepEqual(cellsOf(out.global.rows), [REL('repel', '2026-10-05T09:00', 'primary, secondary')]);
  // The name order in a mutual row does not matter: tab order decides who yields.
  const reversed = regen(rotations, [REL('repel', '2026-10-05T09:00', 'secondary, primary')]);
  assert.deepEqual(whoOf(reversed, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(reversed, 'secondary'), ['bob', 'carol', 'alice']);
});

test('one-sided repel: the reading rotation avoids the other, which is unaffected and decided first', () => {
  const secondary = rotation('secondary', ABC, [REL('repel', '2026-10-05T09:00', 'primary')]);
  const out = regen([secondary, rotation('primary', ABC)]);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'secondary'), ['bob', 'carol', 'alice']);
  const relRow = rotRows(out, 'secondary').find((r) => r.type === 'repel');
  assert.equal(U.rowToArray(relRow)[3], 'primary');
  // primary reading secondary instead flips who yields.
  const flipped = regen([rotation('secondary', ABC), rotation('primary', ABC, [REL('repel', '2026-10-05T09:00', 'secondary')])]);
  assert.deepEqual(whoOf(flipped, 'secondary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(flipped, 'primary'), ['bob', 'carol', 'alice']);
});

test('repel then attract flips the pair, detach clears it, end reverts it', () => {
  // carol is far below in secondary and is taken whenever the relation allows it.
  const low = [R('', '2026-10-05T09:00', 'score', 'carol-=100')];
  const rotations = [rotation('primary', ABC), rotation('secondary', ABC, low)];
  assert.deepEqual(whoOf(regen(rotations, [REL('repel', '2026-10-05T09:00', 'primary, secondary')]), 'secondary'), ['carol', 'carol', 'alice']);
  assert.deepEqual(whoOf(regen(rotations, [
    REL('repel', '2026-10-05T09:00', 'primary, secondary'), REL('attract', '2026-10-19T09:00', 'primary, secondary'),
  ]), 'secondary'), ['carol', 'carol', 'carol']);
  assert.deepEqual(whoOf(regen(rotations, [
    REL('repel', '2026-10-05T09:00', 'primary, secondary'), REL('detach', '2026-10-19T09:00', 'secondary, primary'),
  ]), 'secondary'), ['carol', 'carol', 'carol']);
  assert.deepEqual(whoOf(regen(rotations, [REL('repel', '2026-10-05T09:00', 'primary, secondary', '', '2w')]), 'secondary'), ['carol', 'carol', 'carol']);
  assert.deepEqual(whoOf(regen(rotations, [REL('repel', '2026-10-05T09:00', 'primary, secondary', '2026-10-19T09:00')]), 'secondary'), ['carol', 'carol', 'carol']);
  // A local row at the same instant is processed after #Global and wins for its pair.
  const local = rotation('secondary', ABC, low.concat([REL('detach', '2026-10-05T09:00', 'primary')]));
  assert.deepEqual(whoOf(regen([rotation('primary', ABC), local], [REL('repel', '2026-10-05T09:00', 'primary, secondary')]), 'secondary'), ['carol', 'carol', 'carol']);
});

test('attract prefers the holder of the overlapping shift inside the tolerance band', () => {
  const rotations = [rotation('alerts', 'alice, bob, carol, dave'), rotation('tickets', 'carol, dave, alice, bob')];
  assert.deepEqual(whoOf(regen(rotations), 'tickets'), ['carol', 'dave', 'alice']);
  const out = regen(rotations, [REL('attract', '2026-10-05T09:00', 'alerts, tickets')]);
  assert.deepEqual(whoOf(out, 'alerts'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'tickets'), ['alice', 'bob', 'carol']);
  const excluded = [rotation('alerts', 'alice, bob, carol, dave'), rotation('tickets', 'carol, dave, alice, bob', [R('', '2026-10-05T09:00', 'exclude', 'alice', '', '1w')])];
  assert.deepEqual(whoOf(regen(excluded, [REL('attract', '2026-10-05T09:00', 'alerts, tickets')]), 'tickets'), ['carol', 'bob', 'dave']);
  const ahead = rotation('tickets', 'carol, dave, alice, bob', [R('', '2026-10-05T09:00', 'score', 'alice+=1')]);
  assert.deepEqual(whoOf(regen([rotation('alerts', 'alice, bob, carol, dave'), ahead], [REL('attract', '2026-10-05T09:00', 'alerts, tickets')]), 'tickets'), ['carol', 'bob', 'dave']);
  const tolerant = { ...ahead, rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, tolerance=1'), R('', '2026-10-05T09:00', 'team', 'carol, dave, alice, bob'), R('', '2026-10-05T09:00', 'score', 'alice+=1')]) };
  assert.deepEqual(whoOf(regen([rotation('alerts', 'alice, bob, carol, dave'), tolerant], [REL('attract', '2026-10-05T09:00', 'alerts, tickets')]), 'tickets'), ['alice', 'bob', 'carol']);
  // One-sided attract in tickets' own tab has the same effect; in alerts' tab it does nothing for tickets.
  assert.deepEqual(whoOf(regen([rotation('alerts', 'alice, bob, carol, dave'), rotation('tickets', 'carol, dave, alice, bob', [REL('attract', '2026-10-05T09:00', 'alerts')])]), 'tickets'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(regen([rotation('alerts', 'alice, bob, carol, dave', [REL('attract', '2026-10-05T09:00', 'tickets')]), rotation('tickets', 'carol, dave, alice, bob')]), 'tickets'), ['carol', 'dave', 'alice']);
});

test('different periods: weekly reads daily and daily reads weekly, overlap on intervals', () => {
  const daily = (extra = []) => ({ name: 'daily', rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=2w'), R('', '2026-10-05T09:00', 'team', 'alice, bob'), ...extra]), snapshotAt: MON });
  const weekly = (extra = []) => rotation('weekly', 'alice, bob', [R('x', '2026-10-12T09:00', 'shift', 'bob'), ...extra]);
  // daily reads weekly: every day of alice's week goes to bob, every day of bob's pinned week to alice.
  const dailyReads = regen([weekly(), daily([REL('repel', '2026-10-05T09:00', 'weekly')])]);
  assert.deepEqual(whoOf(dailyReads, 'weekly'), ['alice', 'bob', 'alice']);
  const dailyShifts = shiftsOf(dailyReads, 'daily');
  assert.equal(dailyShifts.length, 14);
  assert.deepEqual(new Set(dailyShifts.slice(0, 7).map((s) => s[1])), new Set(['bob']));
  assert.deepEqual(new Set(dailyShifts.slice(7).map((s) => s[1])), new Set(['alice']));
  // weekly reads daily: at 10-05 the daily rotation has decided only its own 10-05 day (alice), so the weekly
  // slot repels alice and takes bob although bob holds 10-06; the coarser reader only sees the finer shifts
  // decided so far (the caveat of DESIGN 7). 10-19 lies past the daily horizon, so nothing is repelled.
  const weeklyReads = regen([weekly([REL('repel', '2026-10-05T09:00', 'daily')]), daily()]);
  assert.deepEqual(whoOf(weeklyReads, 'daily').slice(0, 3), ['alice', 'bob', 'alice']);
  assert.deepEqual(whoOf(weeklyReads, 'weekly'), ['bob', 'bob', 'alice']);
  assert.deepEqual(plain(weeklyReads.status.shifts.slice(0, 2).map((s) => s.rotation)), ['weekly', 'daily']);
});

test('soft repel: min_distance relaxes first, then repel with a warning and note, then nobody', () => {
  // secondary has only alice, who also holds primary: repel cannot be honoured.
  const out = regen([rotation('primary', 'alice'), rotation('secondary', 'alice')], [REL('repel', '2026-10-05T09:00', 'primary, secondary')]);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shiftsOf(out, 'secondary'), [
    ['2026-10-05T09:00', 'alice', 'repel relaxed: alice also on primary'],
    ['2026-10-12T09:00', 'alice', 'repel relaxed: alice also on primary'],
    ['2026-10-19T09:00', 'alice', 'repel relaxed: alice also on primary'],
  ]);
  assert.deepEqual(plain(out.status.warnings.map((w) => [w.rotation, w.message])), new Array(3).fill(['secondary', 'repel relaxed: alice also on primary']));
  // With min_distance=1sl and two members, the distance is relaxed before repel is dropped.
  const tight = { name: 'secondary', rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, min_distance=1sl'), R('', '2026-10-05T09:00', 'team', 'alice, bob'), R('', '2026-10-05T09:00', 'exclude', 'bob', '', '3w')]), snapshotAt: MON };
  const relaxed = regen([rotation('primary', 'alice, bob'), tight], [REL('repel', '2026-10-05T09:00', 'primary, secondary')]);
  assert.deepEqual(shiftsOf(relaxed, 'secondary').map((s) => [s[1], s[2]]), [
    ['alice', 'repel relaxed: alice also on primary'],
    ['alice', 'min_distance relaxed to 0'],
    ['alice', 'min_distance relaxed to 0; repel relaxed: alice also on primary'],
  ]);
  // Exclusions are never relaxed: nobody plus an error row.
  const stuck = regen([rotation('primary', 'alice'), rotation('secondary', 'alice', [R('', '2026-10-05T09:00', 'exclude', 'alice', '', '3w')])], [REL('repel', '2026-10-05T09:00', 'primary, secondary')]);
  assert.deepEqual(whoOf(stuck, 'secondary'), ['', '', '']);
  assert.equal(errorsOf(stuck, 'secondary').length, 3);
});

test('relation row errors are non-blocking: unknown rotation, self reference, cycle, in #Global and in tabs', () => {
  const primary = rotation('primary', ABC, [REL('repel', '2026-10-05T09:00', 'secondary, nowhere'), REL('attract', '2026-10-05T09:00', 'primary')]);
  const secondary = rotation('secondary', ABC, [REL('repel', '2026-10-05T09:00', 'primary')]);
  const out = regen([primary, secondary], [REL('repel', '2026-10-05T09:00', 'primary, tertiary'), REL('attract', '2026-10-05T09:00', 'primary, secondary')]);
  assert.equal(out.regenerated, true);
  assert.deepEqual(plain(out.errors.map((e) => [e.rotation, e.rowIndex, e.message])), [
    ['primary', 5, 'attract names its own rotation'],
    ['primary', 4, 'unknown rotation "nowhere"'],
    ['#Global', 2, 'unknown rotation "tertiary"'],
  ]);
  assert.deepEqual(errorsOf(out, 'primary'), ['attract names its own rotation', 'unknown rotation "nowhere"']);
  assert.deepEqual(cellsOf(out.global.rows).map((c) => c[2]), ['error', 'attract', 'repel']);
  // The remaining rows work: mutual attract from #Global is overridden for the pair by secondary's local repel.
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'secondary'), ['bob', 'carol', 'alice']);
  assert.deepEqual(plain(out.status.errors), plain(out.errors));
  // Each tab reads the other from the same instant: the pair becomes mutual, no cycle, no error rows, and
  // tab order decides who yields; both avoid each other's holder.
  const same = regen([rotation('primary', ABC, [REL('repel', '2026-10-05T09:00', 'secondary')]), rotation('secondary', ABC, [REL('repel', '2026-10-05T09:00', 'primary')])]);
  assert.deepEqual(plain(same.errors), []);
  assert.deepEqual(whoOf(same, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(same, 'secondary'), ['bob', 'carol', 'alice']);
  const holders = same.status.shifts.reduce((m, s) => Object.assign(m, { [s.start + ':' + s.who]: (m[s.start + ':' + s.who] || 0) + 1 }), {});
  assert.ok(Object.values(holders).every((n) => n === 1), 'no member holds both rotations at one start');
  // Two #Global rows for the same pair in either name order never conflict: the later one just wins.
  const flip = regen([rotation('primary', ABC), rotation('secondary', ABC)], [REL('repel', '2026-10-05T09:00', 'primary, secondary'), REL('attract', '2026-10-12T09:00', 'secondary, primary')]);
  assert.deepEqual(cellsOf(flip.global.rows).map((c) => c[2]), ['repel', 'attract']);
  assert.deepEqual(whoOf(flip, 'secondary'), ['bob', 'carol', 'alice']);
  // Ledger validation errors still block everything and keep the relation error rows in #Global.
  const blocked = regen([rotation('primary', ABC, [R('', '2026-10-12T09:00', 'join', 'alice')]), rotation('secondary', 'alice')], [REL('repel', '2026-10-05T09:00', 'primary, tertiary')]);
  assert.equal(blocked.regenerated, false);
  assert.deepEqual(plain(blocked.errors.map((e) => e.rotation)), ['primary', '#Global']);
});

test('rows no longer in force do not order the sweep: ended, superseded and re-listed relations', () => {
  // primary's ledger starts in 2025 so that it can carry relation rows dated then.
  const primary = (extra = []) => ({ name: 'primary', rows: rows([R('', '2025-01-06T09:00', 'set', 'period=1w, horizon=3w'), R('', '2025-01-06T09:00', 'team', ABC), ...extra]), snapshotAt: MON });
  const secondary = (extra) => rotation('secondary', ABC, extra);
  // (a) primary read secondary in 2025 and stopped; secondary reads primary now: no cycle, secondary yields.
  const ended = regen([primary([REL('repel', '2025-01-06T09:00', 'secondary', '2025-06-01T09:00')]), secondary([REL('repel', '2026-10-05T09:00', 'primary')])]);
  assert.deepEqual(plain(ended.errors), []);
  assert.deepEqual(whoOf(ended, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(ended, 'secondary'), ['bob', 'carol', 'alice']);
  // (b) the same without an end: the 2026 row supersedes the pair state, so still no cycle and no sharing.
  const superseded = regen([primary([REL('repel', '2025-01-06T09:00', 'secondary')]), secondary([REL('repel', '2026-10-05T09:00', 'primary')])]);
  assert.deepEqual(plain(superseded.errors), []);
  assert.deepEqual(whoOf(superseded, 'secondary'), ['bob', 'carol', 'alice']);
  // (c) two #Global rows a year apart naming the pair in the other order: both valid, the later one in force.
  const relisted = regen([primary(), secondary()], [REL('repel', '2025-10-06T09:00', 'primary, secondary'), REL('repel', '2026-10-05T09:00', 'secondary, primary')]);
  assert.deepEqual(plain(relisted.errors), []);
  assert.deepEqual(cellsOf(relisted.global.rows).map((c) => c[2]), ['repel', 'repel']);
  assert.deepEqual(whoOf(relisted, 'secondary'), ['bob', 'carol', 'alice']);
  // A row still in force at the snapshot and a later reverse row do form a cycle within the run.
  const genuine = regen([primary([REL('repel', '2025-01-06T09:00', 'secondary')]), secondary([REL('repel', '2026-10-12T09:00', 'primary')])]);
  assert.deepEqual(errorsOf(genuine, 'primary'), ['relation order cycle among secondary; use a #Global row']);
  assert.deepEqual(errorsOf(genuine, 'secondary'), ['relation order cycle among primary; use a #Global row']);
  assert.deepEqual(whoOf(genuine, 'secondary'), ['alice', 'bob', 'carol']);
});

test('relation rows are kept in place, idempotent, equal after a full replay, and frozen rotations still count', () => {
  const secondary = rotation('secondary', ABC, [REL('repel', '2026-10-05T09:00', 'primary', '', '2w', 'while primary ramps up')]);
  const first = regen([rotation('primary', ABC), secondary]);
  assert.deepEqual(whoOf(first, 'secondary'), ['bob', 'carol', 'alice']);
  const again = regen(first.rotations.map((r) => ({ name: r.name, rows: rows(cellsOf(r.rows)), snapshotAt: MON })));
  assert.deepEqual(first.rotations.map((r) => cellsOf(r.rows)), again.rotations.map((r) => cellsOf(r.rows)));
  const replayed = regen(first.rotations.map((r) => ({ name: r.name, rows: rows(cellsOf(r.rows).filter((c) => c[2] !== 'snapshot')), snapshotAt: MON })));
  assert.deepEqual(first.rotations.map((r) => cellsOf(r.rows)), replayed.rotations.map((r) => cellsOf(r.rows)));
  const kept = cellsOf(rotRows(first, 'secondary')).find((c) => c[2] === 'repel');
  assert.deepEqual(kept, REL('repel', '2026-10-05T09:00', 'primary', '', '2w', 'while primary ramps up'));
  const scoped = regen([rotation('primary', ABC, [R('', '2026-10-05T09:00', 'shift', 'alice'), R('', '2026-10-12T09:00', 'shift', 'alice')]), secondary], [], ['secondary']);
  assert.deepEqual(whoOf(scoped, 'secondary'), ['bob', 'carol', 'alice']);
});

test('runner: #Global rows are written back with error rows and reported; absent #Global stay null', () => {
  const ledgers = {
    primary: [SET, R('', '2026-10-05T09:00', 'team', ABC)],
    secondary: [SET, R('', '2026-10-05T09:00', 'team', ABC)],
  };
  const global = [
    R('', '2026-10-06T09:00', 'error', 'old'),
    R('', '', '', '', '', '', ''),
    REL('repel', '2026-10-05T09:00', 'primary, nowhere'),
    REL('repel', '2026-10-05T09:00', 'primary, secondary'),
    R('', '', '', 'a comment in #Global'),
  ];
  const storage = new MemoryStorage({ ledgers, global });
  const result = runStorage(storage, '2026-10-05T10:00', { write: true });
  assert.deepEqual(result.errors, ['#Global row 4: unknown rotation "nowhere"']);
  assert.equal(result.status.tabs.global, 2);
  assert.deepEqual(result.global.map((c) => [c[2], c[3]]), [
    ['error', 'unknown rotation "nowhere"'], ['repel', 'primary, nowhere'], ['repel', 'primary, secondary'], ['', 'a comment in #Global'],
  ]);
  assert.deepEqual(storage.global, result.global);
  assert.deepEqual(result.ledgers.secondary.filter((c) => c[2] === 'shift').map((c) => c[3]), ['bob', 'carol', 'alice']);
  assert.equal(runStorage(new MemoryStorage({ ledgers }), '2026-10-05T10:00').global, null);
});

test('global set rows layer under rotations: shared tolerance, local override and bare reset', () => {
  const globalRows = [R('', '2026-09-01', 'set', 'tolerance=7')];
  const ledger = (extra) => ({ name: 'primary', rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=5w'), R('', '2026-10-05T09:00', 'team', ABC), R('', '2026-10-05T09:00', 'score', 'alice+=20'), ...extra]), snapshotAt: MON });
  assert.deepEqual(whoOf(regen([ledger([])], globalRows), 'primary'), ['bob', 'carol', 'bob', 'carol', 'alice']);
  const overriding = regen([ledger([R('', '2026-10-05T09:00', 'set', 'tolerance=0')])], globalRows);
  assert.deepEqual(whoOf(overriding, 'primary'), ['bob', 'carol', 'bob', 'carol', 'bob']);
  assert.equal(overriding.status.rotations[0].settings.values.find((v) => v.key === 'tolerance').source, 'rotation');
  const reset = regen([ledger([R('', '2026-10-05T09:00', 'set', 'tolerance=0'), R('', '2026-10-12T09:00', 'set', 'tolerance')])], globalRows);
  assert.deepEqual(whoOf(reset, 'primary'), ['bob', 'carol', 'bob', 'carol', 'alice']);
  const timeline = new U.SettingsTimeline(U.rowsOfType(ledger([R('', '2026-10-05T09:00', 'set', 'tolerance=0'), R('', '2026-10-12T09:00', 'set', 'tolerance')]).rows, 'set'), new Set(), rows(globalRows));
  assert.equal(timeline.at(dt('2026-10-12T09:00')).get('tolerance'), 7);
  assert.equal(timeline.sourcesAt(dt('2026-10-12T09:00')).tolerance, 'global');
});

test('global period and anchor: a rotation may have neither and gets the grid from #Global', () => {
  const globalRows = [R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w')];
  const out = regen([{ name: 'r', rows: rows([R('', '2026-10-05T09:00', 'set', 'tolerance=0'), R('', '2026-10-05T09:00', 'team', 'alice, bob')]), snapshotAt: MON }], globalRows);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(shiftsOf(out, 'r').map((s) => s[0]), ['2026-10-05T09:00', '2026-10-12T09:00', '2026-10-19T09:00']);
  const settings = out.status.rotations[0].settings.values;
  assert.deepEqual(plain(settings.filter((v) => v.key === 'period' || v.key === 'anchor').map((v) => [v.value, v.source])), [['1w', 'global'], ['2026-10-05T09:00', 'global']]);
  const bad = regen([rotation('primary', 'alice, bob')], [R('', '2026-10-05T09:00', 'set', 'tolerance=abc')]);
  assert.equal(bad.regenerated, false);
  assert.deepEqual(plain(bad.errors), [{ rotation: '#Global', rowIndex: 2, start: MON, message: 'bad value for tolerance: "abc"; use a number of days or an interval like 2sl, 1ts, 3d or 0' }]);
});
