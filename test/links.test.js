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
const shiftsOf = (out, name) => plain(out.rotations.find((r) => r.name === name).rows
  .filter((r) => r.type === 'shift').map((r) => [U.formatDateTime(r.start), r.what]));
const whoOf = (out, name) => shiftsOf(out, name).map((s) => s[1]);

const SET = R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w');
const rotation = (name, team, extra = []) => ({ name, rows: rows([SET, R('', '2026-10-05T09:00', 'team', team), ...extra]), snapshotAt: MON });
const LINK = (start, arg, end, duration) => R('', start, 'link', arg, end, duration);
const regen = (rotations, links) => U.regenerate({ rotations, holidays: [], global: rows(links) });

test('parseLinkArg accepts "kind: a, b" and rejects the rest', () => {
  assert.deepEqual(plain(U.parseLinkArg('distinct: primary, secondary')), { kind: 'distinct', rotations: ['primary', 'secondary'] });
  assert.deepEqual(plain(U.parseLinkArg(' Joined :alerts;tickets ; ops')), { kind: 'joined', rotations: ['alerts', 'tickets', 'ops'] });
  assert.equal(U.parseLinkArg('shared: a, b'), null);
  assert.equal(U.parseLinkArg('distinct a, b'), null);
  assert.equal(U.parseLinkArg('distinct: a'), null);
  assert.equal(U.parseLinkArg('distinct: a, a'), null);
  assert.equal(U.parseLinkArg(''), null);
});

test('parseGlobal: intervals, unlink closing the matching link, error rows for rejected rows', () => {
  const cells = [
    R('', '2026-10-26T09:00', 'unlink', 'distinct: secondary, primary'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary', '', '2w'),
    LINK('2026-10-12T09:00', 'joined: primary, secondary', '2026-10-19T09:00'),
    R('', '2026-10-06T09:00', 'error', 'stale'),
  ];
  const out = U.parseGlobal(rows(cells), ['primary', 'secondary']);
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

test('parseGlobal: rejected rows get an error row above them and are ignored', () => {
  const cells = [
    LINK('2026-10-05T09:00', 'distinct: primary, tertiary'),
    LINK('2026-10-05T09:00', 'distinct: primary'),
    R('', '2026-10-05T09:00', 'bond', 'joined: primary, secondary'),
    R('', 'soon', 'link', 'joined: primary, secondary'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary', '2026-10-19T09:00', '1w'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary', '2026-10-05T09:00'),
    R('', '2026-10-12T09:00', 'unlink', 'distinct: primary, secondary'),
    R('', '2026-10-12T09:00', 'unlink', 'joined: primary, secondary', '', '1w'),
    LINK('2026-10-05T09:00', 'joined: primary, secondary'),
  ];
  const out = U.parseGlobal(rows(cells), ['primary', 'secondary']);
  assert.deepEqual(plain(out.errors.map((e) => [e.rowIndex, e.message])), [
    [2, 'unknown rotation "tertiary"'],
    [3, 'what must be "distinct: a, b" or "joined: a, b"'],
    [4, 'unknown type "bond"'],
    [6, 'end and duration are mutually exclusive'],
    [7, 'end must be after start'],
    [8, 'unlink: no active distinct link for primary, secondary'],
    [9, 'unlink does not take end or duration'],
    [5, 'bad start "soon"'],
  ]);
  assert.deepEqual(plain(out.links), [{ kind: 'joined', rotations: ['primary', 'secondary'], from: MON, to: null }]);
  const written = cellsOf(out.rows);
  assert.equal(written.filter((c) => c[2] === 'error').length, 8);
  assert.equal(written[0][2], 'error');
  assert.equal(written[0][3], 'unknown rotation "tertiary"');
  assert.deepEqual(written[written.length - 1].slice(1, 3), ['soon', 'link']);
  assert.deepEqual(written[written.length - 2].slice(1, 4), ['soon', 'error', 'bad start "soon"']);
});

test('parseGlobal: comment rows are kept, sorted like ledger comments and never validated', () => {
  const cells = [
    R('', '', '', 'links between the two rotations'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
    R('', '2026-10-06T09:00', '', 'dated note'),
    R('', '', '', 'trailing'),
  ];
  const out = U.parseGlobal(rows(cells), ['primary', 'secondary']);
  assert.deepEqual(plain(out.errors), []);
  assert.equal(out.links.length, 1);
  assert.deepEqual(cellsOf(out.rows).map((c) => [c[1], c[2], c[3]]), [
    ['', '', 'links between the two rotations'], ['2026-10-05T09:00', 'link', 'distinct: primary, secondary'],
    ['2026-10-06T09:00', '', 'dated note'], ['', '', 'trailing'],
  ]);
});

test('parseGlobal: set rows are validated and returned; a bad one blocks regeneration', () => {
  const cells = [
    R('', '2026-10-05T09:00', 'set', 'tolerance=7, anchor'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
    R('', '2026-10-12T09:00', 'set', 'tolerance=abc'),
    R('', '2026-10-19T09:00', 'set', 'period'),
  ];
  const out = U.parseGlobal(rows(cells), ['primary', 'secondary']);
  assert.deepEqual(plain(out.setRows.map((r) => r.what)), ['tolerance=7, anchor']);
  assert.deepEqual(plain(out.setErrors.map((e) => [e.rowIndex, e.message])), [[4, 'bad value for tolerance: "abc"'], [5, 'period requires a value']]);
  assert.equal(out.links.length, 1);
  assert.deepEqual(cellsOf(out.rows).map((c) => c[2]), ['set', 'link', 'error', 'set', 'error', 'set']);
  const blocked = regen([rotation('primary', 'alice, bob'), rotation('secondary', 'alice')], [R('', '2026-10-05T09:00', 'set', 'tolerance=abc')]);
  assert.equal(blocked.regenerated, false);
  assert.deepEqual(plain(blocked.errors), [{ rotation: '#Global', rowIndex: 2, start: MON, message: 'bad value for tolerance: "abc"' }]);
  assert.deepEqual(plain(blocked.rotations.map((r) => r.rows.filter((x) => x.type === 'shift').length)), [0, 0]);
  assert.equal(cellsOf(blocked.global.rows)[0][2], 'error');
});

test('global set rows layer under rotations: shared tolerance, local override and bare reset', () => {
  // alice starts 20 ahead. With the global tolerance 7 she becomes a candidate once the others reach 14
  // (11-02); with a local tolerance 0 she never does within the horizon.
  const globalRows = [R('', '2026-09-01T00:00', 'set', 'tolerance=7')];
  const ledger = (extra) => ({ name: 'primary', rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=5w'), R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'), R('', '2026-10-05T09:00', 'score', 'alice+=20'), ...extra]), snapshotAt: MON });
  const shared = regen([ledger([])], globalRows);
  assert.deepEqual(whoOf(shared, 'primary'), ['bob', 'carol', 'bob', 'carol', 'alice']);
  const overriding = regen([ledger([R('', '2026-10-05T09:00', 'set', 'tolerance=0')])], globalRows);
  assert.deepEqual(whoOf(overriding, 'primary'), ['bob', 'carol', 'bob', 'carol', 'bob']);
  const reset = regen([ledger([R('', '2026-10-05T09:00', 'set', 'tolerance=0'), R('', '2026-10-12T09:00', 'set', 'tolerance')])], globalRows);
  assert.deepEqual(whoOf(reset, 'primary'), ['bob', 'carol', 'bob', 'carol', 'alice']);
  assert.equal(overriding.status.rotations[0].settings.values.find((v) => v.key === 'tolerance').source, 'rotation');
  // The status block is dated at the snapshot (10-05), where the local override still holds; from 10-12 the
  // bare key hands tolerance back to #Global.
  const settings = reset.status.rotations[0].settings.values;
  const tol = settings.find((v) => v.key === 'tolerance');
  assert.deepEqual([tol.value, tol.source], ['0', 'rotation']);
  assert.equal(settings.find((v) => v.key === 'period').source, 'rotation');
  assert.equal(settings.find((v) => v.key === 'seed').source, 'default');
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
  const missing = regen([{ name: 'r', rows: rows([R('', '2026-10-05T09:00', 'set', 'tolerance=0'), R('', '2026-10-05T09:00', 'team', 'alice')]), snapshotAt: MON }], []);
  assert.match(missing.errors[0].message, /first row must be a set row \(period own or from #Global\)/);
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
  assert.deepEqual(cellsOf(out.global.rows), [LINK('2026-10-05T09:00', 'distinct: primary, secondary')]);
});

test('distinct: rotation order at equal starts follows the link list', () => {
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol')];
  const out = regen(rotations, [LINK('2026-10-05T09:00', 'distinct: secondary, primary')]);
  assert.deepEqual(whoOf(out, 'secondary'), ['alice', 'bob', 'carol']);
  assert.deepEqual(whoOf(out, 'primary'), ['bob', 'carol', 'alice']);
});

test('distinct: pinned shifts count, intervals are compared across different periods', () => {
  const primary = rotation('primary', 'alice, bob', [R('x', '2026-10-12T09:00', 'shift', 'bob')]);
  const daily = { name: 'daily', rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1d, horizon=2w'), R('', '2026-10-05T09:00', 'team', 'alice, bob')]), snapshotAt: MON };
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
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol', [R('', '2026-10-05T09:00', 'score', 'carol-=100')])];
  const link = LINK('2026-10-05T09:00', 'distinct: primary, secondary');
  assert.deepEqual(whoOf(regen(rotations, [link]), 'secondary'), ['carol', 'carol', 'alice']);
  const unlinked = regen(rotations, [link, R('', '2026-10-19T09:00', 'unlink', 'distinct: secondary, primary')]);
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
  const excluded = [rotation('alerts', 'alice, bob, carol, dave'), rotation('tickets', 'carol, dave, alice, bob', [R('', '2026-10-05T09:00', 'exclude', 'alice', '', '1w')])];
  assert.deepEqual(whoOf(regen(excluded, [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]), 'tickets'), ['carol', 'bob', 'dave']);
});

test('joined: outside the tolerance band normal selection applies', () => {
  const tickets = rotation('tickets', 'carol, dave, alice, bob', [R('', '2026-10-05T09:00', 'score', 'alice+=1')]);
  const out = regen([rotation('alerts', 'alice, bob, carol, dave'), tickets], [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]);
  assert.deepEqual(whoOf(out, 'tickets'), ['carol', 'bob', 'dave']);
  const tolerant = { ...tickets, rows: rows([R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w, tolerance=1'), R('', '2026-10-05T09:00', 'team', 'carol, dave, alice, bob'), R('', '2026-10-05T09:00', 'score', 'alice+=1')]) };
  assert.deepEqual(whoOf(regen([rotation('alerts', 'alice, bob, carol, dave'), tolerant], [LINK('2026-10-05T09:00', 'joined: alerts, tickets')]), 'tickets'), ['alice', 'bob', 'carol']);
});

test('link errors do not block regeneration and appear in errors, status and the #Global rows', () => {
  const rotations = [rotation('primary', 'alice, bob, carol'), rotation('secondary', 'alice, bob, carol')];
  const out = regen(rotations, [
    LINK('2026-10-05T09:00', 'distinct: primary, tertiary'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
  ]);
  assert.deepEqual(whoOf(out, 'secondary'), ['bob', 'carol', 'alice']);
  assert.deepEqual(plain(out.errors), [{ rotation: '#Global', rowIndex: 2, start: MON, message: 'unknown rotation "tertiary"' }]);
  assert.deepEqual(plain(out.status.errors), plain(out.errors));
  assert.deepEqual(cellsOf(out.global.rows).map((c) => c[2]), ['error', 'link', 'link']);
  const blocked = regen([rotation('primary', 'alice, bob, carol', [R('', '2026-10-12T09:00', 'join', 'alice')]), rotation('secondary', 'alice')], [LINK('2026-10-05T09:00', 'distinct: primary, tertiary')]);
  assert.deepEqual(plain(blocked.errors.map((e) => e.rotation)), ['primary', '#Global']);
  assert.equal(cellsOf(blocked.global.rows)[0][2], 'error');
});

test('runner: #Global rows are written back with error rows and reported; absent #Global stay null', () => {
  const ledgers = {
    primary: [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob, carol')],
    secondary: [SET, R('', '2026-10-05T09:00', 'team', 'alice, bob, carol')],
  };
  const links = [
    R('', '2026-10-06T09:00', 'error', 'old'),
    R('', '', '', '', '', '', ''),
    LINK('2026-10-05T09:00', 'distinct: primary, nowhere'),
    LINK('2026-10-05T09:00', 'distinct: primary, secondary'),
  ];
  links.push(R('', '', '', 'a comment in #Global'));
  const storage = new MemoryStorage({ ledgers, global: links });
  const result = runStorage(storage, '2026-10-05T10:00', { write: true });
  assert.deepEqual(result.errors, ['#Global row 4: unknown rotation "nowhere"']);
  assert.equal(result.status.tabs.global, 2);
  assert.equal(result.global[result.global.length - 1][3], 'a comment in #Global');
  assert.deepEqual(result.global.map((c) => [c[2], c[3]]), [
    ['error', 'unknown rotation "nowhere"'], ['link', 'distinct: primary, nowhere'], ['link', 'distinct: primary, secondary'], ['', 'a comment in #Global'],
  ]);
  assert.deepEqual(storage.global, result.global);
  assert.deepEqual(result.ledgers.secondary.filter((c) => c[2] === 'shift').map((c) => c[3]), ['bob', 'carol', 'alice']);
  const none = runStorage(new MemoryStorage({ ledgers }), '2026-10-05T10:00');
  assert.equal(none.global, null);
});
