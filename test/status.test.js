'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();
const { runStorage, statusText } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const dt = (s) => U.parseDateTime(s);
const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];

// Monday 2026-10-05: bob excluded for ten days from the snapshot, carol pins the third week, dave alone in secondary.
const ledgers = {
  primary: [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w'),
    R('', '2026-10-05T09:00', 'team', 'alice, bob, carol'),
    R('', '2026-10-05T09:00', 'exclude', 'bob', '', '10d', 'travel'),
    R('x', '2026-10-19T09:00', 'shift', 'carol', '', '', 'volunteered'),
  ],
  secondary: [
    R('', '2026-10-05T09:00', 'set', 'period=1w, horizon=3w'),
    R('', '2026-10-05T09:00', 'team', 'dave'),
  ],
};
const NOW = '2026-10-05T10:00';

test('status: scores, last and next shift, active exclusions, instants', () => {
  const { status, errors } = runStorage(new MemoryStorage({ ledgers, holidays: ['2026-12-25'], ignored: ['Notes'] }), NOW);
  assert.deepEqual(errors, []);
  assert.equal(status.now, NOW);
  assert.equal(status.mode, 'dry run');
  assert.deepEqual(status.tabs, { rotations: ['primary', 'secondary'], holidays: 1, links: 0, ignored: ['Notes'] });
  const [primary, secondary] = status.rotations;
  assert.equal(primary.snapshotAt, dt('2026-10-05T09:00'));
  assert.equal(primary.horizonEnd, dt('2026-10-26T09:00'));
  assert.deepEqual(primary.roster, [
    { name: 'alice', score: null, projected: 7, lastShift: dt('2026-10-05T09:00'), nextShift: null, exclusions: [] },
    { name: 'bob', score: null, projected: 0, lastShift: null, nextShift: null, exclusions: [{ from: dt('2026-10-05T09:00'), to: dt('2026-10-15T09:00') }] },
    { name: 'carol', score: null, projected: 14, lastShift: null, nextShift: dt('2026-10-12T09:00'), exclusions: [] },
  ]);
  assert.deepEqual(secondary.roster, [
    { name: 'dave', score: null, projected: 21, lastShift: dt('2026-10-05T09:00'), nextShift: dt('2026-10-12T09:00'), exclusions: [] },
  ]);
  assert.deepEqual(status.warnings, []);
  assert.deepEqual(status.errors, []);
});

test('status: shifts view lists every shift by start then rotation order', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers }), NOW);
  assert.deepEqual(status.shifts.map((s) => [U.formatDateTime(s.start), U.formatDateTime(s.end), s.rotation, s.what, s.pinned, s.note]), [
    ['2026-10-05T09:00', '2026-10-12T09:00', 'primary', 'alice', false, ''],
    ['2026-10-05T09:00', '2026-10-12T09:00', 'secondary', 'dave', false, ''],
    ['2026-10-12T09:00', '2026-10-19T09:00', 'primary', 'carol', false, ''],
    ['2026-10-12T09:00', '2026-10-19T09:00', 'secondary', 'dave', false, ''],
    ['2026-10-19T09:00', '2026-10-26T09:00', 'primary', 'carol', true, 'volunteered'],
    ['2026-10-19T09:00', '2026-10-26T09:00', 'secondary', 'dave', false, ''],
  ]);
});

test('statusRows and shiftsRows: fixed width text tables', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers, ignored: ['Notes', '#old'] }), NOW);
  const rows = structuredClone(U.statusRows(status));
  assert.ok(rows.every((r) => r.length === 6));
  assert.deepEqual(rows[0], ['Rotalator', 'dry run', NOW, '', '', '']);
  assert.deepEqual(rows.slice(1, 7), [
    ['', '', '', '', '', ''],
    ['tabs', '', '', '', '', ''],
    ['rotations', 'primary, secondary', '', '', '', ''],
    ['holidays', '0', '', '', '', ''],
    ['links', '0', '', '', '', ''],
    ['ignored', 'Notes, #old', '', '', '', ''],
  ]);
  assert.deepEqual(rows[8], ['rotation', 'primary', 'snapshot', '2026-10-05T09:00', 'horizon', '2026-10-26T09:00']);
  assert.deepEqual(rows[9], ['member', 'score', 'projected', 'last shift', 'next shift', 'exclusions']);
  assert.deepEqual(rows[11], ['bob', '', '0.00', '', '', '2026-10-05T09:00 to 2026-10-15T09:00']);
  assert.deepEqual(rows[rows.length - 2], ['warnings', '', '', '', '', '']);
  assert.deepEqual(rows[rows.length - 1], ['rotation', 'start', 'message', '', '', '']);
  assert.equal(U.formatExclusions([{ from: dt('2026-10-05T09:00'), to: null }]), '2026-10-05T09:00 to open');
  const shifts = structuredClone(U.shiftsRows(status.shifts));
  assert.deepEqual(shifts[0], ['start', 'end', 'rotation', 'what', 'pinned', 'note']);
  assert.deepEqual(shifts[5], ['2026-10-19T09:00', '2026-10-26T09:00', 'primary', 'carol', 'yes', 'volunteered']);
  assert.equal(shifts.length, 7);
  assert.match(statusText(status), /^Rotalator {2}dry run +2026-10-05T10:00\n/);
});

test('status on validation error: errors block, no rotations, no shifts', () => {
  const broken = structuredClone(ledgers);
  broken.primary.push(R('', '2026-10-12T09:00', 'holiday', ''));
  const { status } = runStorage(new MemoryStorage({ ledgers: broken }), NOW, { write: true });
  assert.equal(status.mode, 'run');
  assert.deepEqual(status.rotations, []);
  assert.deepEqual(status.shifts, []);
  assert.deepEqual(status.errors.map((e) => [e.rotation, e.rowIndex, e.message]), [['primary', 6, 'unknown type "holiday"']]);
  const rows = structuredClone(U.statusRows(status));
  assert.deepEqual(rows.slice(-3), [
    ['errors', '', '', '', '', ''],
    ['rotation', 'where', 'message', '', '', ''],
    ['primary', 'row 6', 'unknown type "holiday"', '', '', ''],
  ]);
  assert.deepEqual(structuredClone(U.shiftsRows(status.shifts)), [['start', 'end', 'rotation', 'what', 'pinned', 'note']]);
});
