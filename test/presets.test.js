'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../node/load.js');

const U = load();
const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const G = (preset, setting, value) => [preset, setting, value];

const text = (t) => (t === '' ? null : t);
const SETTINGS = {
  id:   { parse: text, def: null, hint: 'an id', required: true },
  text: { parse: text, def: '{who} on {rotation}', template: true },
  on:   { parse: (t) => U.parseBoolean(t), def: true, hint: 'true or false' },
  count: { parse: (t) => U.parseInteger(t), def: 0 },
};
const NAMES = ['who', 'rotation', 'start', 'end'];
const OPTIONS = { tab: '#Test', placeholders: NAMES };

test('parsePresetTab: presets in tab order with defaults, setRows and notes; comments skipped', () => {
  const rows = [G('', '', 'a comment'), G('a', '', 'first'), G('', 'id', 'x'), G('', 'ON', 'false'), G('', '', ''), G('b', '', ''), G('', 'id', 'y'), G('', 'text', '{who}'), G('', 'count', '3')];
  const out = plain(U.parsePresetTab(rows, SETTINGS, OPTIONS));
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.presets, [
    { name: 'a', note: 'first', row: 3, setRows: { id: 4, on: 5 }, errors: [], id: 'x', text: '{who} on {rotation}', on: false, count: 0 },
    { name: 'b', note: '', row: 7, setRows: { id: 8, text: 9, count: 10 }, errors: [], id: 'y', text: '{who}', on: true, count: 3 },
  ]);
  assert.deepEqual(plain(U.parsePresetTab([], SETTINGS, OPTIONS)), { presets: [], errors: [] });
  assert.deepEqual(plain(U.parsePresetTab(null, SETTINGS, OPTIONS)), { presets: [], errors: [] });
  assert.equal(U.isValidPresetName('team-1_x'), true);
  assert.equal(U.isValidPresetName('te am'), false);
  assert.equal(U.isValidPresetName(''), false);
});

test('parsePresetTab: every error, where names the row after the write-back, presets with errors kept', () => {
  const rows = [
    G('', 'id', 'early'),
    G('bad name', '', ''),
    G('', 'id', 'x'),
    G('team', '', ''),
    G('', 'id', 'x'),
    G('', 'colour', 'red'),
    G('', 'id', 'again'),
    G('', 'on', 'maybe'),
    G('', 'count', 'many'),
    G('', 'text', '{who} {what} {start:%Q %q %Q}'),
    G('team', '', 'second'),
    G('', 'id', 'dup'),
    G('noid', '', ''),
    G('ok', '', ''),
    G('', 'id', 'z'),
  ];
  const out = plain(U.parsePresetTab(rows, SETTINGS, OPTIONS));
  assert.deepEqual(out.errors, [
    { row: 2, where: '#Test row 3', message: 'setting "id" before any preset' },
    { row: 3, where: '#Test row 5', message: 'bad preset name "bad name"; use letters, digits, - and _ without spaces' },
    { row: 7, where: '#Test row 10', message: 'unknown setting "colour"' },
    { row: 8, where: '#Test row 12', message: 'duplicate setting "id"' },
    { row: 9, where: '#Test row 14', message: 'bad value for on: "maybe"; use true or false' },
    { row: 10, where: '#Test row 16', message: 'bad value for count: "many"' },
    { row: 11, where: '#Test row 20', message: 'unknown placeholder {what} in text' },
    { row: 11, where: '#Test row 20', message: 'unknown directive %Q in text' },
    { row: 11, where: '#Test row 20', message: 'unknown directive %q in text' },
    { row: 12, where: '#Test row 22', message: 'duplicate preset "team"' },
    { row: 14, where: '#Test row 25', message: 'preset "noid" has no id' },
  ]);
  assert.deepEqual(out.presets.map((p) => [p.name, p.errors.length]), [['bad name', 1], ['team', 7], ['team', 1], ['noid', 1], ['ok', 0]]);
  assert.deepEqual(out.presets[3].errors, ['no id']);
  assert.equal(out.presets[1].text, '{who} {what} {start:%Q %q %Q}', 'a template with unknown parts is kept verbatim');
  // A template setting may parse to a list of templates, each checked.
  const LIST = { to: { parse: (t) => t.split(',').map((x) => x.trim()), def: [], template: true } };
  const list = plain(U.parsePresetTab([G('p', '', ''), G('', 'to', '{who}, {nope}, {next}')], LIST, { tab: '#T', placeholders: ['who'] }));
  assert.deepEqual(list.errors.map((e) => e.message), ['unknown placeholder {nope} in to', 'unknown placeholder {next} in to']);
  assert.deepEqual(list.presets[0].to, ['{who}', '{nope}', '{next}']);
  // check(preset) reports on the preset row and marks the preset unusable.
  const checked = plain(U.parsePresetTab([G('p', '', ''), G('', 'id', 'x'), G('', 'count', '0')], SETTINGS, { tab: '#T', check: (p) => (p.count === 0 ? 'preset "' + p.name + '" needs a count' : null) }));
  assert.deepEqual(checked.errors, [{ row: 2, where: '#T row 3', message: 'preset "p" needs a count' }]);
  assert.deepEqual(checked.presets[0].errors, ['preset "p" needs a count']);
  assert.deepEqual(plain(U.parsePresetTab([G('p', '', ''), G('', 'id', 'x'), G('', 'count', '1')], SETTINGS, { tab: '#T', check: (p) => (p.count === 0 ? 'nope' : null) })).errors, []);
});

test('presetRowsWithErrors: error rows above the offending rows, padded, dropped on read', () => {
  const rows = [G('', 'id', 'early'), G('team', '', 'ok'), G('', 'id', 'x'), G('', 'colour', 'red'), ['noid']];
  const parsed = U.parsePresetTab(rows, SETTINGS, OPTIONS);
  assert.deepEqual(plain(parsed.errors).map((e) => [e.row, e.where]), [[2, '#Test row 3'], [5, '#Test row 7'], [6, '#Test row 9']]);
  const withErrors = plain(U.presetRowsWithErrors(rows, parsed.errors));
  assert.deepEqual(withErrors, [
    ['', 'error', 'setting "id" before any preset'],
    ['', 'id', 'early'],
    ['team', '', 'ok'],
    ['', 'id', 'x'],
    ['', 'error', 'unknown setting "colour"'],
    ['', 'colour', 'red'],
    ['', 'error', 'preset "noid" has no id'],
    ['noid', '', ''],
  ]);
  // Several errors on one row keep their list order; unsorted input is sorted by row first.
  const two = U.parsePresetTab([G('t', '', ''), G('', 'id', 'x'), G('', 'text', '{a} {start:%q}')], SETTINGS, OPTIONS);
  assert.deepEqual(plain(U.presetRowsWithErrors([['t'], ['', 'id', 'x'], ['', 'text', '{a} {start:%q}']], [{ row: 4, message: 'unknown placeholder {a} in text' }, { row: 2, message: 'first' }, { row: 4, message: 'unknown directive %q in text' }])), [
    ['', 'error', 'first'], ['t', '', ''], ['', 'id', 'x'],
    ['', 'error', 'unknown placeholder {a} in text'], ['', 'error', 'unknown directive %q in text'],
    ['', 'text', '{a} {start:%q}'],
  ]);
  assert.deepEqual(plain(U.presetRowsWithErrors([['t'], ['', 'id', 'x'], ['', 'text', '{a} {start:%q}']], two.errors)), [
    ['t', '', ''], ['', 'id', 'x'],
    ['', 'error', 'unknown placeholder {a} in text'], ['', 'error', 'unknown directive %q in text'],
    ['', 'text', '{a} {start:%q}'],
  ]);
  assert.deepEqual(plain(U.dropPresetErrorRows(withErrors)), plain(U.presetRowsWithErrors(rows, [])));
  assert.equal(U.isPresetErrorRow(['', 'Error', 'x']), true);
  assert.equal(U.isPresetErrorRow(['p', 'error', 'x']), false, 'a preset named error is not an error row');
  assert.equal(U.isPresetErrorRow(['', 'id', 'error']), false);
  assert.deepEqual(plain(U.PRESET_HEADER), ['preset', 'setting', 'value']);
  assert.equal(U.PRESET_ERROR_TYPE, 'error');
});

test('strftime subset', () => {
  const t = dt('2026-10-05T09:07');
  const f = (fmt, at = t) => U.strftime(fmt, at).text;
  assert.equal(f('%Y-%m-%d %H:%M'), '2026-10-05 09:07');
  assert.equal(f('%e|%a|%A|%b|%B|%j|%u|%%'), '5|Mon|Monday|Oct|October|278|1|%');
  assert.equal(f('%a %u %j', dt('2026-01-04')), 'Sun 7 004');
  assert.equal(f('%B %e', dt('2026-02-28T23:59')), 'February 28');
  const odd = U.strftime('%q and %d%', t);
  assert.equal(odd.text, '%q and 05%');
  assert.deepEqual(plain(odd.unknown), ['%q', '%'], 'a trailing % is reported');
});

test('formatTemplate: the keys of values are the placeholders; start and end are instants; templateErrors once each', () => {
  const values = { who: 'alice', rotation: 'primary', note: 'swap', pin: 'x', start: dt('2026-10-05'), end: dt('2026-10-12T09:00') };
  const out = U.formatTemplate('{rotation}: {who} [{pin}] {start} to {end} ({start:%a %e %b}-{end:%a %e %b %H:%M}) {note} {nope} {start:%Z}', values);
  assert.equal(out.text, 'primary: alice [x] 2026-10-05 to 2026-10-12T09:00 (Mon 5 Oct-Mon 12 Oct 09:00) swap {nope} %Z');
  assert.deepEqual(plain(out.unknown), ['{nope}', '%Z']);
  assert.equal(U.formatTemplate('{note}|{pin}', { note: null, pin: undefined }).text, '|');
  assert.equal(U.formatTemplate('{note}|{pin}', { note: 'n' }).text, 'n|{pin}', 'a name outside values is unknown');
  assert.equal(U.formatTemplate('no placeholders {} {Who} {START:%d}', values).text, 'no placeholders {} alice 05', 'names are case-insensitive');
  assert.equal(U.formatTemplate('{who:%d}', values).text, 'alice', 'a format on a non-instant is ignored');
  assert.equal(U.formatTemplate('{group}', { group: 'S1' }).text, 'S1', 'any name may be a placeholder');
  assert.deepEqual(plain(U.templateErrors('{Nope} {end:%}', 'title', NAMES)), ['unknown placeholder {Nope} in title', 'unknown directive % in title']);
  assert.deepEqual(plain(U.templateErrors('{a} {a} {start:%q%q} {b}', 'body', NAMES)), ['unknown placeholder {a} in body', 'unknown directive %q in body', 'unknown placeholder {b} in body']);
  assert.deepEqual(plain(U.templateErrors('{who} {prev} {start:%a}', 'text', ['who', 'prev', 'start'])), []);
  assert.deepEqual(plain(U.templateErrors('{who} {prev}', 'text', ['who'])), ['unknown placeholder {prev} in text']);
});
