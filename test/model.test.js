'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const R = (pin, start, type, what, end, duration, note) => [pin, start, type, what, end ?? '', duration ?? '', note ?? ''];

const SET = R('', '2026-10-05T09:00', 'set', 'period=1w');
const TEAM = R('', '2026-10-05T09:00', 'team', 'alice, bob');

function ledger(...extra) {
  return [SET, TEAM, ...extra].map((cells, i) => U.rowFromArray(cells, i + 2));
}

function messagesOf(cellsRows) {
  const rows = cellsRows.map((cells, i) => U.rowFromArray(cells, i + 2));
  return plain(U.validateLedger(rows, 'r').errors.map((e) => e.message));
}

test('LEDGER_HEADER and isLedgerHeader', () => {
  assert.deepEqual(plain(U.LEDGER_HEADER), ['pin', 'start', 'type', 'what', 'end', 'duration', 'note']);
  assert.equal(U.isLedgerHeader(['pin', 'start', 'type', 'what', 'end', 'duration', 'note']), true);
  assert.equal(U.isLedgerHeader([' Pin', 'START', 'type', 'What', 'end', 'duration', 'note', 'extra']), true);
  assert.equal(U.isLedgerHeader(['start', 'type']), false);
  assert.equal(U.isLedgerHeader(['pin', 'start', 'type', 'who', 'arg', 'end', 'duration', 'note']), false);
  assert.equal(U.isLedgerHeader(['pin', 'start', 'type', 'what', 'end', 'note', 'duration']), false);
  assert.equal(U.isLedgerHeader(null), false);
});

test('tab names: system prefix, known system tabs, preview names', () => {
  assert.equal(U.HOLIDAYS_TAB, '#Holidays');
  assert.equal(U.GLOBAL_TAB, '#Global');
  assert.equal(U.STATUS_TAB, '#Status');
  assert.equal(U.ALL_SHIFTS_TAB, '#All shifts');
  assert.equal(U.isSystemTab('#primary'), true);
  assert.equal(U.isSystemTab('primary'), false);
  assert.equal(U.isSystemTab('.old'), false);
  for (const name of ['#Holidays', '#Global', '#Status', '#All shifts', '#Preview primary', '#Preview Global']) {
    assert.equal(U.isKnownSystemTab(name), true, name);
  }
  assert.equal(U.isKnownSystemTab('#primary'), false);
  assert.equal(U.isKnownSystemTab('primary'), false);
  assert.equal(U.previewTabName('primary'), '#Preview primary');
  assert.equal(U.previewTabName('#Global'), '#Preview Global');
});

test('rowFromArray parses fields and resolves duration into end', () => {
  const row = U.rowFromArray(['x', '2026-10-05 09:00', 'Shift', ' alice ', '', '1d12h', 'n'], 7);
  assert.equal(row.rowIndex, 7);
  assert.equal(row.pinned, true);
  assert.equal(row.pin, 'x');
  assert.equal(row.start, dt('2026-10-05T09:00'));
  assert.equal(row.type, 'shift');
  assert.equal(row.what, 'alice');
  assert.equal(row.duration, 2160);
  assert.equal(row.end, dt('2026-10-06T21:00'));
  assert.equal(row.note, 'n');

  const explicit = U.rowFromArray(['', '2026-10-05T09:00', 'shift', 'bob', '2026-10-07T09:00', '', ''], 1);
  assert.equal(explicit.pinned, false);
  assert.equal(explicit.duration, null);
  assert.equal(explicit.end, dt('2026-10-07T09:00'));

  const bad = U.rowFromArray([false, 'nope', 'shift', 42, 'later', '3x'], 3);
  assert.equal(bad.pinned, false);
  assert.equal(U.rowFromArray([true, '2026-10-05T09:00', 'shift', 'a'], 1).pinned, true);
  assert.equal(bad.start, null);
  assert.equal(bad.startText, 'nope');
  assert.equal(bad.what, '42');
  assert.equal(bad.end, null);
  assert.equal(bad.endText, 'later');
  assert.equal(bad.duration, null);
  assert.equal(bad.note, '');
});

test('rowToArray writes canonical forms and keeps the user\'s end/duration choice', () => {
  const cells = ['x', '2026-10-05 09:00', 'SHIFT', 'alice', '', '1d12h', 'n'];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(cells, 1))), ['x', '2026-10-05T09:00', 'shift', 'alice', '', '1d12h', 'n']);
  const withEnd = ['', '2026-10-05T09:00', 'shift', 'bob', '2026-10-07 09:00', '', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(withEnd, 1))), ['', '2026-10-05T09:00', 'shift', 'bob', '2026-10-07T09:00', '', '']);
  const broken = ['', 'nope', 'shift', 'bob', 'later', '3x', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(broken, 1))), ['', 'nope', 'shift', 'bob', 'later', '3x', '']);
  const both = ['', '2026-10-05T09:00', 'shift', 'bob', '2026-10-07 09:00', '1d', ''];
  assert.deepEqual(plain(U.rowToArray(U.rowFromArray(both, 1))), ['', '2026-10-05T09:00', 'shift', 'bob', '2026-10-07T09:00', '1d', '']);
  assert.deepEqual(plain(U.rowToArray(U.makeRow({ start: 0, type: 'shift', what: 'a', duration: 60 }))), ['', '1970-01-01', 'shift', 'a', '', '1h', '']);
});

test('makeRow fills defaults and derives end from duration', () => {
  const row = U.makeRow({ start: 100, type: 'shift', what: 'alice', duration: 60 });
  assert.equal(row.end, 160);
  assert.equal(row.pinned, false);
  assert.equal(row.note, '');
  assert.equal(U.makeRow({ start: 0, type: 'shift', pin: 'x' }).pinned, true);
  assert.deepEqual(plain(U.rowToArray(U.makeRow({ start: 0, type: 'error', what: 'msg' }))), ['', '1970-01-01', 'error', 'msg', '', '', '']);
});

test('isNobody, shiftAssignee, whatItems and whatNames', () => {
  for (const w of ['', ' ', '-', 'none', 'None', null, undefined]) assert.equal(U.isNobody(w), true, String(w));
  for (const w of ['alice', '--', 'nobody']) assert.equal(U.isNobody(w), false, w);
  assert.equal(U.shiftAssignee(U.makeRow({ type: 'shift', what: 'alice' })), 'alice');
  assert.equal(U.shiftAssignee(U.makeRow({ type: 'shift', what: '-' })), null);
  assert.equal(U.shiftAssignee(U.makeRow({ type: 'shift', what: '' })), null);
  assert.deepEqual(plain(U.whatItems(U.makeRow({ type: 'team', what: 'alice, bob=3' }))), [
    { name: 'alice', op: null, value: null }, { name: 'bob', op: '=', value: '3' },
  ]);
  assert.deepEqual(plain(U.whatNames(U.makeRow({ type: 'leave', what: 'alice; bob' }))), ['alice', 'bob']);
  assert.deepEqual(plain(U.whatItems(U.makeRow({ type: 'team', what: 'a+b' }))), []);
});

test('comments: empty type parses as comment, writes back empty, never validated', () => {
  const dated = U.rowFromArray(R('', '2026-10-06T09:00', '', 'vacation season'), 4);
  assert.equal(dated.type, 'comment');
  assert.deepEqual(plain(U.rowToArray(dated)), R('', '2026-10-06T09:00', '', 'vacation season'));
  const undated = U.rowFromArray(R('', '', '', 'todo: add erin'), 5);
  assert.equal(undated.type, 'comment');
  assert.equal(undated.start, null);
  const garbage = U.rowFromArray(R('', 'someday', '', 'note'), 6);
  assert.equal(garbage.type, 'comment');
  assert.deepEqual(plain(U.rowToArray(garbage)), R('', 'someday', '', 'note'));
  assert.deepEqual(messagesOf([SET, TEAM, R('', '2026-10-06T09:00', '', 'x'), R('', '', '', 'y'), R('', 'someday', '', 'z'), R('', '', '', '', '', '2x', '')]), []);
  assert.deepEqual(messagesOf([R('', '2026-10-01T09:00', '', 'before the set row'), SET, TEAM]), []);
  assert.deepEqual(messagesOf([R('', '', '', 'only a comment')]), ['r: ledger is empty']);
});

test('sortRows: dated comments first at their instant, undated ones attach to the next dated row', () => {
  const t = dt('2026-10-05T09:00');
  const mk = (type, start, what) => U.makeRow({ type, start, what });
  const c = (start, what) => U.makeRow({ type: 'comment', start, what });
  const rows = [
    c(null, 'above set'), mk('set', t, 'period=1w'),
    c(null, 'above dated'),
    c(t, 'dated'), mk('shift', t, 'alice'), c(null, 'above bob'), c(null, 'also above bob'), mk('shift', t + 1, 'bob'),
    mk('error', t, 'e'), c(null, 'trailing 1'), c(null, 'trailing 2'),
  ];
  const sorted = U.sortRows(rows);
  assert.deepEqual(sorted.map((r) => r.what), [
    'above dated', 'dated', 'e', 'above set', 'period=1w', 'alice', 'above bob', 'also above bob', 'bob', 'trailing 1', 'trailing 2',
  ]);
  assert.deepEqual(U.sortRows(sorted).map((r) => r.what), sorted.map((r) => r.what));
  const badStart = U.makeRow({ type: 'shift', start: null, startText: 'nope', what: 'z' });
  assert.deepEqual(U.sortRows([c(null, 'skips bad start'), badStart, mk('shift', t, 'a')]).map((r) => r.what), ['skips bad start', 'a', 'z']);
  const errorRow = U.makeRow({ type: 'error', start: null, startText: 'nope', what: 'bad start' });
  assert.deepEqual(U.sortRows([c(null, 'trailing'), errorRow, badStart]).map((r) => r.what), ['bad start', 'z', 'trailing']);
});

test('attachComments stores the key once so a comment stays above its instant when the row below is replaced', () => {
  const t = dt('2026-10-05T09:00');
  const comment = U.makeRow({ type: 'comment', what: 'swap this one' });
  const shift = U.makeRow({ type: 'shift', start: t + 1440, what: 'alice' });
  const rows = U.attachComments([U.makeRow({ type: 'set', start: t, what: 'period=1w' }), comment, shift]);
  assert.equal(comment.attachedStart, t + 1440);
  assert.equal(comment.attachedOrder, U.ROW_TYPES.shift.order - 0.5);
  const replacement = U.makeRow({ type: 'shift', start: t + 1440, what: 'bob' });
  const resorted = U.sortRows([replacement, rows[0], comment]);
  assert.deepEqual(resorted.map((r) => r.what), ['period=1w', 'swap this one', 'bob']);
  const unresolved = U.makeRow({ type: 'comment', what: 'fresh' });
  assert.deepEqual(U.sortRows([replacement, unresolved]).map((r) => r.what), ['bob', 'fresh']);
});

test('epoch rows: undated set, team, repel and attract parse to EPOCH, write back undated, sort first', () => {
  const set = U.rowFromArray(R('', '', 'set', 'period=1w'), 2);
  assert.equal(set.start, -Infinity);
  assert.ok(U.isEpochRow(set));
  assert.deepEqual(plain(U.rowToArray(set)), R('', '', 'set', 'period=1w'));
  for (const type of ['team', 'repel', 'attract']) assert.ok(U.isEpochRow(U.rowFromArray(R('', '', type, 'x'), 2)), type);
  for (const type of ['shift', 'join', 'leave', 'exclude', 'include', 'score', 'detach', 'snapshot']) {
    assert.equal(U.rowFromArray(R('', '', type, 'x'), 2).start, null, type);
  }
  assert.equal(U.rowFromArray(R('', '', '', 'note'), 2).start, null);
  const t = dt('2026-10-05T09:00');
  const sorted = U.sortRows([
    U.makeRow({ type: 'shift', start: t, what: 'a' }), U.makeRow({ type: 'set', start: t, what: 'anchor' }),
    U.makeRow({ type: 'team', start: -Infinity, what: 'a, b' }), U.makeRow({ type: 'comment', what: 'above epoch set' }),
    U.makeRow({ type: 'set', start: -Infinity, what: 'period=1w' }), U.makeRow({ type: 'repel', start: -Infinity, what: 'other' }),
    U.makeRow({ type: 'comment', what: 'trailing' }),
  ]);
  assert.deepEqual(sorted.map((r) => r.what), ['above epoch set', 'period=1w', 'other', 'a, b', 'anchor', 'a', 'trailing']);
});

test('epoch rows: validation of duplicates, bare anchor, extent and the first-row rule', () => {
  const epochSet = R('', '', 'set', 'period=1w, tolerance=0');
  const anchorRow = R('', '2026-10-05T09:00', 'set', 'anchor');
  assert.deepEqual(messagesOf([epochSet, R('', '', 'team', 'alice'), anchorRow]), []);
  assert.deepEqual(messagesOf([epochSet, R('', '', 'set', 'seed=2'), anchorRow]), ['more than one undated set row']);
  assert.deepEqual(messagesOf([epochSet, R('', '', 'team', 'alice'), R('', '', 'team', 'bob'), anchorRow]), ['more than one undated team row']);
  assert.deepEqual(messagesOf([R('', '', 'set', 'period=1w, anchor'), anchorRow]), ['anchor needs a dated set row']);
  assert.deepEqual(messagesOf([epochSet, R('', '', 'repel', 'other', '', '2w'), anchorRow]), ['undated repel rows take no end or duration']);
  assert.deepEqual(messagesOf([epochSet, R('', '', 'shift', 'alice'), anchorRow]), ['missing start']);
  // Whether a period and an anchor are in force is the scheduler's check, not a row rule.
  assert.deepEqual(messagesOf([R('', '', 'set', 'tolerance=0'), anchorRow]), []);
});

test('sortRows orders by start then type, stable, nulls last', () => {
  const t = dt('2026-10-05T09:00');
  const mk = (type, start, what) => U.makeRow({ type, start, what });
  const rows = [
    mk('shift', t, 'a'), mk('shift', null, 'z'), mk('include', t), mk('shift', t - 1, 'b'), mk('exclude', t),
    mk('score', t), mk('leave', t), mk('join', t), mk('team', t), mk('snapshot', t), mk('set', t), mk('error', t),
    mk('shift', t, 'c'), mk('bogus', t),
  ];
  const sorted = U.sortRows(rows);
  assert.deepEqual(sorted.map((r) => r.type + (r.what ? ':' + r.what : '')),
    ['shift:b', 'error', 'set', 'snapshot', 'team', 'score', 'join', 'leave', 'exclude', 'include', 'shift:a', 'shift:c', 'bogus', 'shift:z']);
  assert.notEqual(sorted, rows);
});

test('settings data and parseSetArg with values and bare keys', () => {
  const d = U.defaultSettings();
  assert.equal(d.period, null);
  assert.equal(d.anchor, null);
  assert.deepEqual(plain(d.horizon), { text: '20w', unit: 'clock', amount: 20, minutes: 20 * 10080 });
  assert.equal(d.tiebreak, 'order');
  assert.equal(d.baseline, 'median');
  assert.deepEqual(plain(d.precredit), { text: '1ts', unit: 'ts', amount: 1, minutes: null });
  assert.deepEqual(plain(d.min_distance), { text: '0.5ts', unit: 'ts', amount: 0.5, minutes: null });
  assert.deepEqual(plain(d.tolerance), { text: '0.5sl', unit: 'sl', amount: 0.5, minutes: null });
  assert.equal(d.skip_weekends, true);
  assert.equal(d.skip_holidays, true);
  assert.deepEqual(plain(d.autopin), { marker: 'a', sign: 1, interval: { text: '2sl', unit: 'sl', amount: 2, minutes: null }, text: 'a:2sl' });

  const start = dt('2026-10-05T09:00');
  const ok = U.parseSetArg('period=2w, anchor; horizon=30d, skip_weekends=yes, skip_holidays=FALSE, tolerance=0.5, min_distance=1sl, tiebreak=Shuffle, seed=-7, baseline=Mean, precredit=3d', start);
  assert.equal(ok.error, null);
  assert.deepEqual(plain(ok.reset), []);
  assert.deepEqual(plain(ok.values), {
    period: 20160, anchor: start, horizon: { text: '30d', unit: 'clock', amount: 30, minutes: 30 * 1440 }, skip_weekends: true, skip_holidays: false,
    tolerance: 0.5, min_distance: { text: '1sl', unit: 'sl', amount: 1, minutes: null }, tiebreak: 'shuffle', seed: -7, baseline: 'mean',
    precredit: { text: '3d', unit: 'clock', amount: 3, minutes: 3 * 1440 },
  });
  assert.match(U.parseSetArg('precredit=auto', start).error, /bad value for precredit: "auto"; use an interval like 2sl, 1ts, 3d or 0/);
  assert.match(U.parseSetArg('min_distance=2', start).error, /bad value for min_distance: "2"; use an interval/);
  assert.equal(U.parseSetArg('min_distance=0', start).values.min_distance.minutes, 0);
  assert.equal(U.parseSetArg('tolerance=1sl', start).values.tolerance.unit, 'sl');
  const bare = U.parseSetArg('horizon, skip_weekends, skip_holidays, tolerance, min_distance, tiebreak, seed, baseline, precredit, autopin', start);
  assert.equal(bare.error, null);
  assert.deepEqual(plain(bare.reset), ['horizon', 'skip_weekends', 'skip_holidays', 'tolerance', 'min_distance', 'tiebreak', 'seed', 'baseline', 'precredit', 'autopin']);
  assert.deepEqual(plain(U.parseSetArg('period=1w, anchor', start).reset), []);
  assert.deepEqual(plain(bare.values), {
    horizon: plain(d.horizon), skip_weekends: true, skip_holidays: true, tolerance: plain(d.tolerance), min_distance: plain(d.min_distance),
    tiebreak: 'order', seed: 0, baseline: 'median', precredit: plain(d.precredit), autopin: plain(d.autopin),
  });
  const ap = (text) => plain(U.parseSetArg('autopin=' + text, start).values.autopin);
  assert.equal(ap('false'), false);
  assert.equal(ap('FALSE'), false);
  assert.deepEqual(ap('2w'), { marker: 'a', sign: 1, interval: { text: '2w', unit: 'clock', amount: 2, minutes: 2 * 10080 }, text: '2w' });
  assert.deepEqual(ap('-2w'), { marker: 'a', sign: -1, interval: { text: '2w', unit: 'clock', amount: 2, minutes: 2 * 10080 }, text: '-2w' });
  assert.deepEqual(ap('1sl'), { marker: 'a', sign: 1, interval: { text: '1sl', unit: 'sl', amount: 1, minutes: null }, text: '1sl' });
  assert.deepEqual(ap('keep: 0.5ts'), { marker: 'keep', sign: 1, interval: { text: '0.5ts', unit: 'ts', amount: 0.5, minutes: null }, text: 'keep:0.5ts' });
  assert.deepEqual(ap('a:b:-3d').marker, 'a:b');
  assert.equal(ap('a:2w').text, 'a:2w');
  assert.equal(ap('-0').text, '0');
  assert.deepEqual(ap('a:2sl'), plain(d.autopin));
  assert.equal(plain(U.parseSetArg('autopin', start).values.autopin).text, 'a:2sl');
  for (const bad of [':2w', 'abc', '2x', 'true', 'x:', '--2w']) {
    assert.match(U.parseSetArg('autopin=' + bad, start).error, /bad value for autopin: .*; use false, or an interval relative to now/, bad);
  }
  assert.match(U.parseSetArg('period', start).error, /period requires a value/);
  assert.match(U.parseSetArg('anchor=2026-10-05T09:00', start).error, /anchor takes no value/);
  assert.match(U.parseSetArg('tolerance+=1', start).error, /set expects key or key=value, got "tolerance\+="/);
  assert.match(U.parseSetArg('seed=1, Seed', start).error, /duplicate setting "Seed"/);
  for (const bad of ['period=12h', 'period=0d', 'foo=1', 'foo', 'horizon=0d', 'skip_weekends=maybe',
    'tolerance=-1', 'tolerance=1sl2d', 'min_distance=1.5', 'min_distance=2', 'tiebreak=random', 'seed=1.5', 'baseline=7', 'precredit=-1', 'precredit=auto', 'horizon=0', 'alice=']) {
    assert.equal(typeof U.parseSetArg(bad, start).error, 'string', bad);
  }
});

test('validateLedger accepts every item form and drops error rows', () => {
  const rows = ledger(
    R('', '2026-10-05T09:00', 'error', 'stale'),
    R('', '2026-10-05T09:00', 'shift', 'alice', '', '', 'gen'),
    R('x', '2026-10-12T09:00', 'shift', 'bob', '', '1w'),
    R('', '2026-10-14', 'exclude', 'alice, bob', '2026-10-20', '', 'offsite'),
    R('', '2026-10-15T09:00', 'join', 'carol=min; dave'),
    R('', '2026-10-16T09:00', 'join', 'erin=12'),
    R('', '2026-10-17T09:00', 'leave', 'bob, dave'),
    R('', '2026-10-18T09:00', 'include', 'alice'),
    R('', '2026-10-19T09:00', 'score', 'alice=10, carol+=2; erin-=1.5, bob, dave=median'),
    R('', '2026-10-19T09:00', 'team', 'alice, carol=median, dave=12, erin+=2'),
    R('', '2026-10-19T09:00', 'set', 'tolerance=1, anchor, precredit'),
    R('', '2026-10-26T09:00', 'shift', '-'),
    R('', '2026-10-26T09:00', 'snapshot', 'alice=12.50, carol=11.00'),
    R('', '2026-11-02T09:00', 'shift', 'none'),
    R('', '2026-11-09T09:00', 'snapshot', ''),
  );
  const { rows: kept, errors } = U.validateLedger(rows, 'alerts');
  assert.deepEqual(plain(errors), ['more than one snapshot row'].map((message) => ({ rowIndex: 18, start: dt('2026-11-09T09:00'), startText: '2026-11-09T09:00', message })));
  assert.equal(kept.length, rows.length - 1);
  assert.ok(kept.every((r) => r.type !== 'error'));
  assert.deepEqual(plain(kept.slice(0, 3).map((r) => r.type)), ['set', 'team', 'shift']);
});

test('validateLedger reports each stateless rule with row references', () => {
  const cases = [
    [R('', '2026-10-06T09:00', 'party', ''), /unknown type "party"/],
    [R('', '', 'shift', 'alice'), /missing start/],
    [R('', '2026-10-06 25:00', 'shift', 'alice'), /bad start/],
    [R('', '2026-10-06T09:00', 'shift', 'alice', 'soon'), /bad end "soon"/],
    [R('', '2026-10-06T09:00', 'shift', 'alice', '', '2x'), /bad duration "2x"/],
    [R('', '2026-10-06T09:00', 'shift', 'alice', '', '0d'), /bad duration "0d"/],
    [R('', '2026-10-06T09:00', 'shift', 'alice', '2026-10-07T09:00', '1d'), /mutually exclusive/],
    [R('', '2026-10-06T09:00', 'shift', 'alice', '2026-10-06T09:00'), /end must be after start/],
    [R('', '2026-10-06T09:00', 'join', 'carol', '', '1d'), /join does not take end or duration/],
    [R('', '2026-10-06T09:00', 'join', ''), /join requires what/],
    [R('', '2026-10-06T09:00', 'leave', ''), /leave requires what/],
    [R('', '2026-10-06T09:00', 'exclude', ''), /exclude requires what/],
    [R('', '2026-10-06T09:00', 'include', ''), /include requires what/],
    [R('', '2026-10-06T09:00', 'team', ''), /team requires what/],
    [R('', '2026-10-06T09:00', 'score', ''), /score requires what/],
    [R('', '2026-10-06T09:00', 'shift', 'alice, bob'), /shift takes exactly one member id/],
    [R('', '2026-10-06T09:00', 'shift', 'alice=1'), /shift takes exactly one member id/],
    [R('', '2026-10-06T09:00', 'shift', 'a+b'), /shift takes exactly one member id/],
    [R('', '2026-10-06T09:00', 'leave', 'alice=1'), /leave takes names only, got "alice="/],
    [R('', '2026-10-06T09:00', 'exclude', 'alice+=1'), /exclude takes names only, got "alice\+="/],
    [R('', '2026-10-06T09:00', 'include', 'alice, bob-=1'), /include takes names only, got "bob-="/],
    [R('', '2026-10-06T09:00', 'join', 'carol+=1'), /join takes name or name=baseline, got "carol\+="/],
    [R('', '2026-10-06T09:00', 'join', 'carol=average'), /bad value for carol: "average"/],
    [R('', '2026-10-06T09:00', 'join', 'a+b'), /bad assignment "a\+b"/],
    [R('', '2026-10-06T09:00', 'team', 'alice=, bob'), /bad assignment "alice="/],
    [R('', '2026-10-06T09:00', 'team', 'alice=soon'), /bad value for alice: "soon"/],
    [R('', '2026-10-06T09:00', 'team', 'alice+=x'), /bad adjustment for alice: "x"/],
    [R('', '2026-10-06T09:00', 'score', 'alice=soon'), /bad value for alice: "soon"/],
    [R('', '2026-10-06T09:00', 'score', 'alice-=x'), /bad adjustment for alice: "x"/],
    [R('', '2026-10-06T09:00', 'snapshot', 'alice+=1'), /snapshot expects name=number, got "alice\+="/],
    [R('', '2026-10-06T09:00', 'snapshot', 'alice'), /snapshot expects name=number, got "alice"/],
    [R('', '2026-10-06T09:00', 'snapshot', 'alice=median'), /bad value for alice: "median"/],
    [R('', '2026-10-06T09:00', 'set', 'colour=red'), /unknown setting "colour"/],
    [R('', '2026-10-06T09:00', 'set', 'period=12h'), /bad value for period/],
    [R('', '2026-10-06T09:00', 'set', 'period'), /period requires a value/],
    [R('', '2026-10-06T09:00', 'set', 'anchor=2026-10-06T09:00'), /anchor takes no value/],
    [R('', '2026-10-06T09:00', 'set', 'tolerance+=1'), /set expects key or key=value/],
    [R('', '2026-10-06T09:00', 'set', 'seed=1, seed=2'), /duplicate setting "seed"/],
  ];
  for (const [cells, re] of cases) {
    const msgs = messagesOf([SET, TEAM, cells]);
    assert.equal(msgs.length, 1, JSON.stringify(cells) + ' -> ' + JSON.stringify(msgs));
    assert.match(msgs[0], re, JSON.stringify(cells));
  }
  const bad = U.rowFromArray(R('', '2026-10-06T09:00', 'shift', 'alice, bob'), 9);
  const { errors } = U.validateLedger(ledger().concat([bad]), 'r');
  assert.equal(errors[0].rowIndex, 9);
  assert.equal(errors[0].start, dt('2026-10-06T09:00'));
});

test('validateLedger rotation-level rules', () => {
  // A ledger whose first row is not a set row, or whose set rows lack a period, is stateless-valid; the
  // scheduler reports the missing grid.
  assert.deepEqual(messagesOf([TEAM, SET.with(1, '2026-10-06T09:00')]), []);
  assert.deepEqual(messagesOf([R('', '2026-10-05T09:00', 'set', 'tolerance=1'), TEAM]), []);
  assert.deepEqual(messagesOf([R('', '2026-10-05T09:00', 'set', ''), TEAM]), []);
  assert.deepEqual(messagesOf([SET, TEAM, R('', '2026-10-06T09:00', 'set', '')]), []);
  assert.match(messagesOf([])[0], /r: ledger is empty/);
  assert.deepEqual(messagesOf([R('', '2026-10-05T09:00', 'set', 'anchor, period=1w'), TEAM]), []);
  const twoSnapshots = messagesOf([SET, TEAM,
    R('', '2026-10-05T09:00', 'snapshot', 'alice=1'),
    R('', '2026-10-12T09:00', 'snapshot', 'alice=1')]);
  assert.deepEqual(twoSnapshots, ['more than one snapshot row']);
  const unsortedOk = messagesOf([TEAM, R('', '2026-10-05T09:00', 'shift', 'alice'), SET]);
  assert.deepEqual(unsortedOk, []);
});
