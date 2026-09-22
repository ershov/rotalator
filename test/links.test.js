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

const R = (pin, start, type, who, arg, end, duration, note) => [pin, start, type, who, arg, end ?? '', duration ?? '', note ?? ''];
const rows = (cells) => cells.map((c, i) => U.rowFromArray(c, i + 2));
const cellsOf = (rowList) => plain(rowList.map(U.rowToArray));
const shiftsOf = (out, name) => plain(out.rotations.find((r) => r.name === name).rows
  .filter((r) => r.type === 'shift').map((r) => [U.formatDateTime(r.start), r.who]));
const whoOf = (out, name) => shiftsOf(out, name).map((s) => s[1]);

const SET = R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=3w');
const rotation = (name, team, extra = []) => ({ name, rows: rows([SET, R('', '2026-10-05T09:00', 'team', '', team), ...extra]), snapshotAt: MON });
const LINK = (start, arg, end, duration) => R('', start, 'link', '', arg, end, duration);
const regen = (rotations, links) => U.regenerate({ rotations, holidays: [], links: rows(links) });

test('parseLinkArg accepts "kind: a, b" and rejects the rest', () => {
  assert.deepEqual(plain(U.parseLinkArg('distinct: primary, secondary')), { kind: 'distinct', rotations: ['primary', 'secondary'] });
  assert.deepEqual(plain(U.parseLinkArg(' Joined :alerts;tickets ; ops')), { kind: 'joined', rotations: ['alerts', 'tickets', 'ops'] });
  assert.equal(U.parseLinkArg('shared: a, b'), null);
  assert.equal(U.parseLinkArg('distinct a, b'), null);
  assert.equal(U.parseLinkArg('distinct: a'), null);
  assert.equal(U.parseLinkArg('distinct: a, a'), null);
  assert.equal(U.parseLinkArg(''), null);
});

test('parseLinks: intervals, unlink closing the matching link, error rows for rejected rows', () => {
  const cells = [
    R('', '2026-10-26T09:00', 'unlink', '', 'distinct: secondary, primary'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary', '', '2w'),
    LINK('2026-10-12T09:00', 'joined: primary, secondary', '2026-10-19T09:00'),
    R('', '2026-10-06T09:00', 'error', '', 'stale'),
  ];
  const out = U.parseLinks(rows(cells), ['primary', 'secondary']);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(plain(out.links), [
    { kind: 'distinct', rotations: ['primary', 'secondary'], from: MON, to: MON + 3 * W },
    { kind: 'joined', rotations: ['primary', 'secondary'], from: MON, to: MON + 2 * W },
    { kind: 'joined', rotations: ['primary', 'secondary'], from: MON + W, to: MON + 2 * W },
  ]);
  assert.deepEqual(cellsOf(out.rows).map((c) => [c[1], c[2]]), [
    ['2026-10-05T09:00', 'link'], ['2026-10-05T09:00', 'link'], ['2026-10-12T09:00', 'link'], ['2026-10-26T09:00', 'unlink'],
  ]);
});

test('parseLinks: rejected rows get an error row above them and are ignored', () => {
  const cells = [
    LINK('2026-10-05T09:00', 'distinct: primary, tertiary'),
    LINK('2026-10-05T09:00', 'distinct: primary'),
    R('', '2026-10-05T09:00', 'link', 'alice', 'joined: primary, secondary'),
    R('', '2026-10-05T09:00', 'bond', '', 'joined: primary, secondary'),
    R('', 'soon', 'link', '', 'joined: primary, secondary'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary', '2026-10-19T09:00', '1w'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary', '2026-10-05T09:00'),
    R('', '2026-10-12T09:00', 'unlink', '', 'distinct: primary, secondary'),
    R('', '2026-10-12T09:00', 'unlink', '', 'joined: primary, secondary', '', '1w'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary'),
  ];
  const out = U.parseLinks(rows(cells), ['primary', 'secondary']);
  assert.deepEqual(plain(out.errors.map((e) => [e.rowIndex, e.message])), [
    [2, 'unknown rotation "tertiary"'],
    [3, 'arg must be "distinct: a, b" or "joined: a, b"'],
    [4, 'link does not take who'],
    [5, 'unknown type "bond"'],
    [7, 'end and duration are mutually exclusive'],
    [8, 'end must be after start'],
    [9, 'unlink: no active distinct link for primary, secondary'],
    [10, 'unlink does not take end or duration'],
    [6, 'bad start "soon"'],
  ]);
  assert.deepEqual(plain(out.links), [{ kind: 'joined', rotations: ['primary', 'secondary'], from: MON, to: null }]);
  const written = cellsOf(out.rows);
  assert.equal(written.filter((c) => c[2] === 'error').length, 9);
  assert.equal(written[0][2], 'error');
  assert.equal(written[0][4], 'unknown rotation "tertiary"');
  assert.deepEqual(written[written.length - 1].slice(1, 3), ['soon', 'link']);
  assert.deepEqual(written[written.length - 2].slice(1, 5), ['soon', 'error', '', 'bad start "soon"']);
});

test('linkedRotationOrder: link list order first, then tab order', () => {
  const links = [{ kind: 'distinct', rotations: ['c', 'a'] }, { kind: 'joined', rotations: ['d', 'a'] }];
  assert.deepEqual(plain(U.linkedRotationOrder(links, ['a', 'b', 'c', 'd'])), ['c', 'a', 'd', 'b']);
  assert.deepEqual(plain(U.linkedRotationOrder([], ['a', 'b'])), ['a', 'b']);
});

test('distinct: the same member never holds overlapping shifts in linked rotations', () => {
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol')];
  const plainRun = regen(rotations, []);
  assert.deepEqual(whoOf(plainRun, 'secondary'), ['alice', 'bob', 'carol']);
  const out = regen(rotations, [LINK('2026-10-05T09:00', 'distinct: primary, secondary')]);
  assert.deepEqual(plain(out.errors), []);
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'secondary'), ['bob', 'carol', 'alice']);
  assert.deepEqual(cellsOf(out.links.rows), [LINK('2026-10-05T09:00', 'distinct: primary, secondary')]);
});

test('distinct: rotation order at equal starts follows the link list', () => {
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol')];
  const out = regen(rotations, [LINK('2026-10-05T09:00', 'distinct: secondary, primary')]);
  assert.deepEqual(whoOf(out, 'secondary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'primary'), ['bob', 'carol', 'alice']);
});

test('distinct: pinned shifts count, intervals are compared across different periods', () => {
  const primary = rotation('primary', 'alice, bob', [R('x', '2026-10-12T09:00', 'shift', 'bob', '')]);
  const daily = { name: 'daily', rows: rows([R('', '2026-10-05T09:00', 'set', '', 'period=1d, horizon=2w'), R('', '2026-10-05T09:00', 'team', '', 'alice, bob')]), snapshotAt: MON };
  const out = regen([primary, daily], [LINK('2026-10-05T09:00', 'distinct: primary, daily')]);
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'bob', 'alice']);
  const dailyShifts = shiftsOf(out, 'daily');
  assert.equal(dailyShifts.length, 14);
  assert.deepEqual(new Set(dailyShifts.slice(0, 7).map((s) => s[1])), new Set(['bob']));
  assert.deepEqual(new Set(dailyShifts.slice(7).map((s) => s[1])), new Set(['alice']));
});

test('distinct is never relaxed: nobody plus an error row when everyone is taken', () => {
  const out = regen([rotation('primary', 'alice'), rotation('secondary', 'alice')], [LINK('2026-10-05T09:00', 'distinct: primary, secondary')]);
  assert.deepEqual(whoOf(out, 'primary'), ['alice', 'alice', 'alice']);
  assert.deepEqual(whoOf(out, 'secondary'), ['', '', '']);
  assert.equal(out.errors.length, 3);
  assert.equal(out.errors[0].rotation, 'secondary');
  assert.match(out.errors[0].message, /no eligible member/);
});

test('unlink ends the constraint; a link with duration ends on its own', () => {
  // carol is far below the others in secondary, so she is chosen whenever distinct allows it.
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol', [R('', '2026-10-05T09:00', 'score', '', 'carol-=100')])];
  const link = LINK('2026-10-05T09:00', 'distinct: primary, secondary');
  assert.deepEqual(whoOf(regen(rotations, [link]), 'secondary'), ['carol', 'carol', 'alice']);
  const unlinked = regen(rotations, [link, R('', '2026-10-19T09:00', 'unlink', '', 'distinct: secondary, primary')]);
  assert.deepEqual(whoOf(unlinked, 'primary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(unlinked, 'secondary'), ['carol', 'carol', 'carol']);
  const timed = regen(rotations, [LINK('2026-10-05T09:00', 'distinct: primary, secondary', '', '2w')]);
  assert.deepEqual(whoOf(timed, 'secondary'), ['carol', 'carol', 'carol']);
});

test('joined: prefers the holder of the overlapping shift when inside the tolerance band', () => {
  const rotations = [rotation('alerts', 'alice, bob, carol, dave'), rotation('tickets', 'carol, dave, alice, bob')];
  assert.deepEqual(whoOf(regen(rotations, []), 'tickets'), ['carol', 'dave', 'alice']);
  const out = regen(rotations, [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]);
  assert.deepEqual(whoOf(out, 'alerts'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'tickets'), ['alice', 'bob', 'carol']);
  const excluded = [rotation('alerts', 'alice, bob, carol, dave'), rotation('tickets', 'carol, dave, alice, bob', [R('', '2026-10-05T09:00', 'exclude', 'alice', '', '', '1w')])];
  assert.deepEqual(whoOf(regen(excluded, [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]), 'tickets'), ['carol', 'bob', 'dave']);
});

test('joined: outside the tolerance band normal selection applies', () => {
  const tickets = rotation('tickets', 'carol, dave, alice, bob', [R('', '2026-10-05T09:00', 'score', '', 'alice+=1')]);
  const out = regen([rotation('alerts', 'alice, bob, carol, dave'), tickets], [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]);
  assert.deepEqual(whoOf(out, 'tickets'), ['carol', 'bob', 'dave']);
  const tolerant = { ...tickets, rows: rows([R('', '2026-10-05T09:00', 'set', '', 'period=1w, horizon=3w, tolerance=1'), R('', '2026-10-05T09:00', 'team', '', 'carol, dave, alice, bob'), R('', '2026-10-05T09:00', 'score', '', 'alice+=1')]) };
  assert.deepEqual(whoOf(regen([rotation('alerts', 'alice, bob, carol, dave'), tolerant], [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]), 'tickets'), ['alice', 'bob', 'carol']);
});

test('link errors do not block regeneration and appear in errors, status and the Links rows', () => {
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol')];
  const out = regen(rotations, [
    LINK('2026-10-05T09:00', 'distinct: primary, tertiary'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
  ]);
  assert.deepEqual(whoOf(out, 'secondary'), ['bob', 'carol', 'alice']);
  assert.deepEqual(plain(out.errors), [{ rotation: 'Links', rowIndex: 2, start: MON, message: 'unknown rotation "tertiary"' }]);
  assert.deepEqual(plain(out.status.errors), plain(out.errors));
  assert.deepEqual(cellsOf(out.links.rows).map((c) => c[2]), ['error', 'link', 'link']);
  const blocked = regen([rotation('primary', 'alice, bob, carol', [R('', '2026-10-12T09:00', 'join', 'alice', '')]), rotation('secondary', 'alice')], [LINK('2026-10-05T09:00', 'distinct: primary, tertiary')]);
  assert.deepEqual(plain(blocked.errors.map((e) => e.rotation)), ['primary', 'Links']);
  assert.equal(cellsOf(blocked.links.rows)[0][2], 'error');
});

test('runner: Links rows are written back with error rows and reported; absent Links stay null', () => {
  const ledgers = {
    primary: [SET, R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol')],
    secondary: [SET, R('', '2026-10-05T09:00', 'team', '', 'alice, bob, carol')],
  };
  const links = [
    R('', '2026-10-06T09:00', 'error', '', 'old'),
    R('', '', '', '', '', '', '', ''),
    LINK('2026-10-05T09:00', 'distinct: primary, nowhere'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
  ];
  const storage = new MemoryStorage({ ledgers, links });
  const result = runStorage(storage, '2026-10-05T10:00', { write: true });
  assert.deepEqual(result.errors, ['Links row 4: unknown rotation "nowhere"']);
  assert.deepEqual(result.links.map((c) => [c[2], c[4]]), [
    ['error', 'unknown rotation "nowhere"'], ['link', 'distinct: primary, nowhere'], ['link', 'distinct: primary, secondary'],
  ]);
  assert.deepEqual(storage.links, result.links);
  assert.deepEqual(result.ledgers.secondary.filter((c) => c[2] === 'shift').map((c) => c[3]), ['bob', 'carol', 'alice']);
  const none = runStorage(new MemoryStorage({ ledgers }), '2026-10-05T10:00');
  assert.equal(none.links, null);
});
