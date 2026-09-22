'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);

const SET = ['', '2026-10-05T09:00', 'set', '', 'period=1w', '', '', ''];
const TEAM = ['', '2026-10-05T09:00', 'team', '', 'alice, bob', '', '', ''];

function ledger(...extra) {
  return [SET, TEAM, ...extra].map((cells, i) => U.rowFromArray(cells, i + 2));
}

function messagesOf(cellsRows) {
  const rows = cellsRows.map((cells, i) => U.rowFromArray(cells, i + 2));
  return plain(U.validateLedger(rows, 'r').errors.map((e) => e.message));
}

test('LEDGER_HEADER and isLedgerHeader', () => {
  assert.deepEqual(plain(U.LEDGER_HEADER), ['pin', 'start', 'type', 'who', 'arg', 'end', 'duration', 'note']);
  assert.equal(U.isLedgerHeader(['pin', 'start', 'type', 'who', 'arg', 'end', 'duration', 'note']), true);
  assert.equal(U.isLedgerHeader([' Pin', 'START', 'type', 'who', 'arg', 'end', 'duration', 'note', 'extra']), true);
  assert.equal(U.isLedgerHeader(['start', 'type']), false);
  assert.equal(U.isLedgerHeader(['pin', 'start', 'type', 'who', 'arg', 'end', 'note', 'duration']), false);
  assert.equal(U.isLedgerHeader(null), false);
});

test('rowFromArray parses fields and resolves duration into end', () => {
  const row = U.rowFromArray(['x', '2026-10-05 09:00', 'Shift', ' alice ', '', '', '1d12h', 'n'], 7);
  assert.equal(row.rowIndex, 7);
  assert.equal(row.pinned, true);
  assert.equal(row.pin, 'x');
  assert.equal(row.start, dt('2026-10-05T09:00'));
  assert.equal(row.type, 'shift');
  assert.equal(row.who, 'alice');
  assert.equal(row.duration, 2160);
  assert.equal(row.end, dt('2026-10-06T21:00'));
  assert.equal(row.note, 'n');

  const explicit = U.rowFromArray(['', '2026-10-05T09:00', 'shift', 'bob', '', '2026-10-07T09:00', '', ''], 1);
  assert.equal(explicit.pinned, false);
  assert.equal(explicit.duration, null);
  assert.equal(explicit.end, dt('2026-10-07T09:00'));

  const bad = U.rowFromArray([false, 'nope', 'shift', undefined, 42, 'later', '3x'], 3);
  assert.equal(bad.pinned, false);
  assert.equal(U.rowFromArray([true, '2026-10-05T09:00', 'shift', 'a'], 1).pinned, true);
  assert.equal(bad.start, null);
  assert.equal(bad.startText, 'nope');
  assert.equal(bad.who, '');
  assert.equal(bad.arg, '42');
  assert.equal(bad.end, null);
  assert.equal(bad.endText, 'later');
  assert.equal(bad.duration, null);
  assert.equal(bad.note, '');
});

test('rowToArray writes canonical forms and keeps the user\'s end/duration choice', () => {
  const cells = ['x', '2026-10-05 09:00', 'SHIFT', 'alice', '', '', '1d12h', 'n'];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(cells, 1))), ['x', '2026-10-05T09:00', 'shift', 'alice', '', '', '1d12h', 'n']);
  const withEnd = ['', '2026-10-05T09:00', 'shift', 'bob', '', '2026-10-07 09:00', '', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(withEnd, 1))), ['', '2026-10-05T09:00', 'shift', 'bob', '', '2026-10-07T09:00', '', '']);
  const broken = ['', 'nope', 'shift', 'bob', '', 'later', '3x', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(broken, 1))), ['', 'nope', 'shift', 'bob', '', 'later', '3x', '']);
  const both = ['', '2026-10-05T09:00', 'shift', 'bob', '', '2026-10-07 09:00', '1d', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(both, 1))), ['', '2026-10-05T09:00', 'shift', 'bob', '', '2026-10-07T09:00', '1d', '']);
  assert.deepEqual(plain(U.rowToArray(U.makeRow({ start: 0, type: 'shift', who: 'a', duration: 60 }))), ['', '1970-01-01T00:00', 'shift', 'a', '', '', '1h', '']);
  const brokenEnd = ['', '2026-10-05T09:00', 'shift', 'bob', '', 'later', '', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(brokenEnd, 1))), ['', '2026-10-05T09:00', 'shift', 'bob', '', 'later', '', '']);
});

test('makeRow fills defaults and derives end from duration', () => {
  const row = U.makeRow({ start: 100, type: 'shift', who: 'alice', duration: 60 });
  assert.equal(row.end, 160);
  assert.equal(row.pinned, false);
  assert.equal(row.note, '');
  assert.equal(U.makeRow({ start: 0, type: 'shift', pin: 'x' }).pinned, true);
  assert.deepEqual(plain(U.rowToArray(U.makeRow({ start: 0, type: 'error', arg: 'msg' }))), ['', '1970-01-01T00:00', 'error', '', 'msg', '', '', '']);
});

test('isNobody', () => {
  for (const w of ['', ' ', '-', 'none', 'None', null, undefined]) assert.equal(U.isNobody(w), true, String(w));
  for (const w of ['alice', '--', 'nobody']) assert.equal(U.isNobody(w), false, w);
});

test('sortRows orders by start then type, stable, nulls last', () => {
  const t = dt('2026-10-05T09:00');
  const mk = (type, start, who) => U.makeRow({ type, start, who });
  const rows = [
    mk('shift', t, 'a'), mk('shift', null, 'z'), mk('include', t), mk('shift', t - 1, 'b'), mk('exclude', t),
    mk('score', t), mk('leave', t), mk('join', t), mk('team', t), mk('snapshot', t), mk('set', t), mk('error', t),
    mk('shift', t, 'c'), mk('bogus', t),
  ];
  const sorted = U.sortRows(rows);
  assert.deepEqual(sorted.map((r) => r.type + (r.who ? ':' + r.who : '')).slice(),
    ['shift:b', 'error', 'set', 'snapshot', 'team', 'join', 'leave', 'score', 'exclude', 'include', 'shift:a', 'shift:c', 'bogus', 'shift:z'].slice());
  assert.notEqual(sorted, rows);
});

test('settings data and parseSetArg', () => {
  const d = U.defaultSettings();
  assert.equal(d.period, null);
  assert.equal(d.horizon, 90 * 1440);
  assert.equal(d.tiebreak, 'order');
  assert.equal(d.baseline, 'median');
  assert.equal(d.precredit, 'auto');
  assert.equal(d.skip_weekends, false);

  const ok = U.parseSetArg('period=2w, anchor=2026-10-05T09:00; horizon=30d, skip_weekends=yes, skip_holidays=FALSE, tolerance=0.5, min_distance=1, tiebreak=Shuffle, seed=-7, baseline=Mean, precredit=3');
  assert.equal(ok.error, null);
  assert.deepEqual(plain(ok.values), {
    period: 20160, anchor: dt('2026-10-05T09:00'), horizon: 30 * 1440, skip_weekends: true, skip_holidays: false,
    tolerance: 0.5, min_distance: 1, tiebreak: 'shuffle', seed: -7, baseline: 'mean', precredit: 3,
  });
  assert.equal(U.parseSetArg('precredit=auto').values.precredit, 'auto');
  for (const bad of ['period=12h', 'period=0d', 'foo=1', 'period+=1', 'anchor=tomorrow', 'horizon=0d', 'skip_weekends=maybe',
    'tolerance=-1', 'min_distance=1.5', 'tiebreak=random', 'seed=1.5', 'baseline=7', 'precredit=-1', 'period', 'seed=1, Seed=2']) {
    assert.equal(typeof U.parseSetArg(bad).error, 'string', bad);
  }
});

test('validateLedger accepts a well-formed ledger and drops error rows', () => {
  const rows = ledger(
    ['', '2026-10-05T09:00', 'error', '', 'stale', '', '', ''],
    ['', '2026-10-05T09:00', 'shift', 'alice', '', '', '', 'gen'],
    ['x', '2026-10-12T09:00', 'shift', 'bob', '', '', '1w', ''],
    ['', '2026-10-14T00:00', 'exclude', 'alice', '', '2026-10-20T00:00', '', 'vacation'],
    ['', '2026-10-15T09:00', 'join', 'carol', 'min', '', '', ''],
    ['', '2026-10-16T09:00', 'join', 'dave', '', '', '', ''],
    ['', '2026-10-17T09:00', 'leave', 'bob', '', '', '', ''],
    ['', '2026-10-18T09:00', 'include', 'alice', '', '', '', ''],
    ['', '2026-10-19T09:00', 'score', '', 'alice=10, carol+=2; dave-=1.5', '', '', ''],
    ['', '2026-10-19T09:00', 'team', '', 'alice, carol=median, dave=12, erin+=2', '', '', ''],
    ['', '2026-10-19T09:00', 'set', '', 'tolerance=1', '', '', ''],
    ['', '2026-10-26T09:00', 'shift', '-', '', '', '', ''],
    ['', '2026-10-26T09:00', 'snapshot', '', 'alice=12.50, carol=11.00', '', '', ''],
    ['', '2026-11-02T09:00', 'shift', 'none', '', '', '', ''],
  );
  const { rows: kept, errors } = U.validateLedger(rows, 'alerts');
  assert.deepEqual(plain(errors), []);
  assert.equal(kept.length, rows.length - 1);
  assert.ok(kept.every((r) => r.type !== 'error'));
  assert.deepEqual(plain(kept.slice(0, 3).map((r) => r.type)), ['set', 'team', 'shift']);
});

test('validateLedger reports each stateless rule with row references', () => {
  const cases = [
    [['', '2026-10-06T09:00', 'party', '', '', '', '', ''], /unknown type "party"/],
    [['', '2026-10-06T09:00', '', '', '', '', '', ''], /missing type/],
    [['', '', 'shift', 'alice', '', '', '', ''], /missing start/],
    [['', '2026-10-06 25:00', 'shift', 'alice', '', '', '', ''], /bad start/],
    [['', '2026-10-06T09:00', 'shift', 'alice', '', 'soon', '', ''], /bad end "soon"/],
    [['', '2026-10-06T09:00', 'shift', 'alice', '', '', '2x', ''], /bad duration "2x"/],
    [['', '2026-10-06T09:00', 'shift', 'alice', '', '', '0d', ''], /bad duration "0d"/],
    [['', '2026-10-06T09:00', 'shift', 'alice', '', '2026-10-07T09:00', '1d', ''], /mutually exclusive/],
    [['', '2026-10-06T09:00', 'shift', 'alice', '', '2026-10-06T09:00', '', ''], /end must be after start/],
    [['', '2026-10-06T09:00', 'join', 'carol', '', '', '1d', ''], /join does not take end or duration/],
    [['', '2026-10-06T09:00', 'join', '', '', '', '', ''], /join requires who/],
    [['', '2026-10-06T09:00', 'leave', '-', '', '', '', ''], /leave requires who/],
    [['', '2026-10-06T09:00', 'exclude', '', '', '', '', ''], /exclude requires who/],
    [['', '2026-10-06T09:00', 'include', 'none', '', '', '', ''], /include requires who/],
    [['', '2026-10-06T09:00', 'team', 'alice', 'alice', '', '', ''], /team does not take who/],
    [['', '2026-10-06T09:00', 'set', 'alice', 'tolerance=1', '', '', ''], /set does not take who/],
    [['', '2026-10-06T09:00', 'score', 'alice', 'alice=1', '', '', ''], /score does not take who/],
    [['', '2026-10-06T09:00', 'shift', 'alice, bob', '', '', '', ''], /exactly one member id/],
    [['', '2026-10-06T09:00', 'shift', 'a=b', '', '', '', ''], /exactly one member id/],
    [['', '2026-10-06T09:00', 'join', 'a+b', '', '', '', ''], /exactly one member id/],
    [['', '2026-10-06T09:00', 'team', '', '', '', '', ''], /team requires arg/],
    [['', '2026-10-06T09:00', 'score', '', '', '', '', ''], /score requires arg/],
    [['', '2026-10-06T09:00', 'set', '', '', '', '', ''], /set requires arg/],
    [['', '2026-10-06T09:00', 'shift', 'alice', 'x', '', '', ''], /shift does not take arg/],
    [['', '2026-10-06T09:00', 'leave', 'alice', 'x', '', '', ''], /leave does not take arg/],
    [['', '2026-10-06T09:00', 'exclude', 'alice', 'x', '', '', ''], /exclude does not take arg/],
    [['', '2026-10-06T09:00', 'include', 'alice', 'x', '', '', ''], /include does not take arg/],
    [['', '2026-10-06T09:00', 'set', '', 'colour=red', '', '', ''], /unknown setting "colour"/],
    [['', '2026-10-06T09:00', 'set', '', 'period=12h', '', '', ''], /bad value for period/],
    [['', '2026-10-06T09:00', 'set', '', 'tolerance+=1', '', '', ''], /set expects key=value/],
    [['', '2026-10-06T09:00', 'set', '', 'seed=1, seed=2', '', '', ''], /duplicate setting "seed"/],
    [['', '2026-10-06T09:00', 'team', '', 'alice=, bob', '', '', ''], /bad assignment/],
    [['', '2026-10-06T09:00', 'team', '', 'alice=soon', '', '', ''], /bad value for alice/],
    [['', '2026-10-06T09:00', 'team', '', 'alice+=x', '', '', ''], /bad adjustment for alice/],
    [['', '2026-10-06T09:00', 'score', '', 'alice', '', '', ''], /score expects name=number/],
    [['', '2026-10-06T09:00', 'score', '', 'alice=median', '', '', ''], /bad number for alice/],
    [['', '2026-10-06T09:00', 'snapshot', '', 'alice+=1', '', '', ''], /snapshot expects name=number/],
    [['', '2026-10-06T09:00', 'join', 'carol', 'average', '', '', ''], /join arg must be/],
  ];
  for (const [cells, re] of cases) {
    const msgs = messagesOf([SET, TEAM, cells]);
    assert.equal(msgs.length, 1, JSON.stringify(cells) + ' -> ' + JSON.stringify(msgs));
    assert.match(msgs[0], re, JSON.stringify(cells));
  }
  const bad = U.rowFromArray(['', '2026-10-06T09:00', 'shift', 'alice, bob', '', '', '', ''], 9);
  const { errors } = U.validateLedger(ledger().concat([bad]), 'r');
  assert.equal(errors[0].rowIndex, 9);
  assert.equal(errors[0].start, dt('2026-10-06T09:00'));
});

test('validateLedger rotation-level rules', () => {
  assert.match(messagesOf([TEAM, SET.with(1, '2026-10-06T09:00')])[0], /r: first row must be a set row with period/);
  assert.match(messagesOf([['', '2026-10-05T09:00', 'set', '', 'tolerance=1', '', '', ''], TEAM])[0], /first row must be a set row with period/);
  assert.match(messagesOf([])[0], /r: ledger is empty/);
  assert.deepEqual(messagesOf([['', '2026-10-05T09:00', 'set', '', 'anchor=2026-10-05T09:00, period=1w', '', '', ''], TEAM]), []);
  const twoSnapshots = messagesOf([SET, TEAM,
    ['', '2026-10-05T09:00', 'snapshot', '', 'alice=1', '', '', ''],
    ['', '2026-10-12T09:00', 'snapshot', '', 'alice=1', '', '', '']]);
  assert.deepEqual(twoSnapshots, ['more than one snapshot row']);
  const unsortedOk = messagesOf([TEAM, ['', '2026-10-05T09:00', 'shift', 'alice', '', '', '', ''], SET]);
  assert.deepEqual(unsortedOk, []);
});
