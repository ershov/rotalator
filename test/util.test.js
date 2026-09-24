'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../node/load.js').load();

// Values built inside the vm context have foreign prototypes; clone before deep comparison.
const plain = (v) => structuredClone(v);

const T0 = Date.UTC(2026, 9, 1, 9, 0) / 60000;

test('parseDateTime accepts canonical, space and date-only forms', () => {
  assert.equal(U.parseDateTime('2026-10-01T09:00'), T0);
  assert.equal(U.parseDateTime('2026-10-01 09:00'), T0);
  assert.equal(U.parseDateTime('2026-10-01'), T0 - 9 * 60);
  assert.equal(U.parseDateTime(' 2026-10-01T09:00 '), T0);
  assert.equal(U.parseDateTime('1970-01-01'), 0);
  assert.equal(U.parseDateTime('2024-02-29'), U.parseDateTime('2024-02-28') + 1440);
});

test('parseDateTime rejects malformed and out-of-range input', () => {
  for (const bad of ['', 'x', '2026-1-01', '20261001', '2026-10-01T9:00', '2026-10-01T09:00:00',
    '2026-13-01', '2026-00-10', '0099-01-01', '0000-01-01', '2026-02-30', '2023-02-29', '2026-10-01T24:00', '2026-10-01T09:60',
    '2026-10-01T09', '2026/10/01', null, undefined, 42]) {
    assert.equal(U.parseDateTime(bad), null, String(bad));
  }
});

test('formatDateTime round-trips and pads', () => {
  assert.equal(U.formatDateTime(T0), '2026-10-01T09:00');
  assert.equal(U.formatDateTime(0), '1970-01-01');
  assert.equal(U.formatDateTime(U.parseDateTime('0100-03-04T05:06')), '0100-03-04T05:06');
  assert.equal(U.parseDateTime(U.formatDateTime(U.parseDateTime('0999-12-31'))), U.parseDateTime('0999-12-31'));
  assert.equal(U.formatDateTime(U.parseDateTime('2026-01-05T07:03')), '2026-01-05T07:03');
});

test('parseDay accepts only YYYY-MM-DD and returns a day index', () => {
  assert.equal(U.parseDay('1970-01-01'), 0);
  assert.equal(U.parseDay('2026-10-01'), U.dayIndex(T0));
  assert.equal(U.formatDay(U.parseDay('2026-10-01')), '2026-10-01');
  for (const bad of ['2026-10-01T00:00', '2026-10-01 00:00', '2026-02-30', '', null]) {
    assert.equal(U.parseDay(bad), null, String(bad));
  }
});

test('day helpers', () => {
  assert.equal(U.dayStart(U.dayIndex(T0)), T0 - 9 * 60);
  assert.equal(U.dayIndex(-1), -1);
  assert.equal(U.weekday(0), 4);
  assert.equal(U.weekday(U.parseDateTime('2026-09-22T12:00')), 2);
  assert.equal(U.weekday(U.parseDateTime('2026-09-20')), 0);
  assert.equal(U.weekday(U.parseDateTime('2026-09-26T23:59')), 6);
  assert.equal(U.weekday(U.parseDateTime('1969-12-31')), 3);
});

test('parseDuration', () => {
  assert.equal(U.parseDuration('1w'), 10080);
  assert.equal(U.parseDuration('3d'), 4320);
  assert.equal(U.parseDuration('12h'), 720);
  assert.equal(U.parseDuration('1d12h'), 2160);
  assert.equal(U.parseDuration('90m'), 90);
  assert.equal(U.parseDuration('1w2d3h4m'), 10080 + 2880 + 180 + 4);
  assert.equal(U.parseDuration(' 1d 12h '), 2160);
  assert.equal(U.parseDuration('0d'), 0);
  for (const bad of ['', '3', 'd', '3x', '12h1d', '1d1d', '1.5d', '-1d', '1D', null]) {
    assert.equal(U.parseDuration(bad), null, String(bad));
  }
});

test('parsePeriod accepts only w and d, and rejects zero', () => {
  assert.equal(U.parsePeriod('1w'), 10080);
  assert.equal(U.parsePeriod('2d'), 2880);
  assert.equal(U.parsePeriod('1w1d'), 11520);
  for (const bad of ['12h', '1d12h', '90m', '0d', '', null]) {
    assert.equal(U.parsePeriod(bad), null, String(bad));
  }
});

test('formatDuration produces the shortest chained form', () => {
  assert.equal(U.formatDuration(10080), '1w');
  assert.equal(U.formatDuration(2160), '1d12h');
  assert.equal(U.formatDuration(90), '1h30m');
  assert.equal(U.formatDuration(1), '1m');
  assert.equal(U.formatDuration(0), '0m');
  assert.equal(U.formatDuration(10080 + 2880 + 180 + 4), '1w2d3h4m');
  assert.equal(U.formatDuration(-1), null);
  assert.equal(U.formatDuration(1.5), null);
  for (const s of ['1w', '3d', '12h', '1d12h', '1h30m']) {
    assert.equal(U.formatDuration(U.parseDuration(s)), s);
  }
});

test('splitList', () => {
  assert.deepEqual(plain(U.splitList('alice, bob;carol ,, dave ;')), ['alice', 'bob', 'carol', 'dave']);
  assert.deepEqual(plain(U.splitList('  ')), []);
  assert.deepEqual(plain(U.splitList('')), []);
  assert.deepEqual(plain(U.splitList(null)), []);
  assert.deepEqual(plain(U.splitList('a=2026-10-01T09:00')), ['a=2026-10-01T09:00']);
});

test('parseAssignments', () => {
  assert.deepEqual(plain(U.parseAssignments('alice, bob, carol=median, dave = 12, erin+=2; frank-=1.5')), [
    { name: 'alice', op: null, value: null },
    { name: 'bob', op: null, value: null },
    { name: 'carol', op: '=', value: 'median' },
    { name: 'dave', op: '=', value: '12' },
    { name: 'erin', op: '+=', value: '2' },
    { name: 'frank', op: '-=', value: '1.5' },
  ]);
  assert.deepEqual(plain(U.parseAssignments('mary-ann=3, -')), [
    { name: 'mary-ann', op: '=', value: '3' },
    { name: '-', op: null, value: null },
  ]);
  assert.deepEqual(plain(U.parseAssignments('')), []);
  for (const bad of ['=5', 'alice=', 'a+b', 'a=b=c', 'alice+=', '+=2', 'a==1', 'ok, bad+1']) {
    assert.equal(typeof U.parseAssignments(bad), 'string', bad);
  }
  assert.match(U.parseAssignments('ok, bad+1'), /bad\+1/);
});

test('fnv1a32 matches reference vectors', () => {
  assert.equal(U.fnv1a32(''), 0x811c9dc5);
  assert.equal(U.fnv1a32('a'), 0xe40c292c);
  assert.equal(U.fnv1a32('foobar'), 0xbf9cf968);
  assert.equal(U.fnv1a32('\u00e9'), 0x1e9de8c1);
  assert.equal(U.fnv1a32('\u{1F600}'), 0x33a29608);
  const lone = U.fnv1a32('\ud800');
  assert.ok(Number.isInteger(lone) && lone >= 0 && lone <= 0xffffffff);
  const h = U.fnv1a32('0|alerts|29800800|alice');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.notEqual(h, U.fnv1a32('0|alerts|29800800|bob'));
});

test('parseCsv handles quotes, embedded separators, newlines and CRLF', () => {
  assert.deepEqual(plain(U.parseCsv('a,b,c\n1,2,3\n')), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(plain(U.parseCsv('a,b\r\n1,2\r\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(plain(U.parseCsv('"x, y","say ""hi""","line1\nline2",\n')), [['x, y', 'say "hi"', 'line1\nline2', '']]);
  assert.deepEqual(plain(U.parseCsv('a,,c\n,,\n')), [['a', '', 'c'], ['', '', '']]);
  assert.deepEqual(plain(U.parseCsv('a\n\n\nb')), [['a'], [''], [''], ['b']]);
  assert.deepEqual(plain(U.parseCsv('')), []);
  assert.deepEqual(plain(U.parseCsv('"a"\r\n"b\r\nc"')), [['a'], ['b\r\nc']]);
  assert.deepEqual(plain(U.parseCsv('""\n\n""\n')), [[''], [''], ['']]);
  assert.deepEqual(plain(U.parseCsv(U.formatCsv([['']]))), [['']]);
});

test('formatCsv quotes only when needed and round-trips', () => {
  const rows = [['pin', 'start', 'note'], ['', '2026-10-01T09:00', 'plain'], ['x', 'a,b', 'say "hi"'], [null, undefined, 'l1\nl2']];
  const text = U.formatCsv(rows);
  assert.equal(text, 'pin,start,note\n,2026-10-01T09:00,plain\nx,"a,b","say ""hi"""\n,,"l1\nl2"\n');
  assert.deepEqual(plain(U.parseCsv(text)), [['pin', 'start', 'note'], ['', '2026-10-01T09:00', 'plain'], ['x', 'a,b', 'say "hi"'], ['', '', 'l1\nl2']]);
  assert.equal(U.formatCsv([]), '');
  assert.equal(U.formatCsv([['']]), '""\n');
  assert.equal(U.formatCsv([[null]]), '""\n');
});
