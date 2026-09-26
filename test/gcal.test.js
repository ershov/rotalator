'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../node/load.js');
const U = load(['GCal']);
const { runDir, runStorage, statusText } = require('../node/cli.js');
const { CsvDirStorage, MemoryStorage } = require('../node/storage.js');

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const FIXTURE = path.join(__dirname, 'fixtures', 'gcal');
const R = (pin, start, type, what, end = '', duration = '', note = '') => [pin, start, type, what, end, duration, note];
const G = (preset, setting, value) => [preset, setting, value];
const NOW = '2026-10-05T10:00';
const BASE = 'period=1w, horizon=2w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0';
const ledger = (set) => ({ primary: [R('', '2026-10-05T09:00', 'set', set), R('', '2026-10-05T09:00', 'team', 'alice, bob')] });
const TEAM = [G('team', '', 'note'), G('', 'id', 'team@example.com')];

test('loader: the extension is in the shared context and its hooks are visible to the core', () => {
  assert.equal(load(), U);
  assert.equal(typeof U.gcal_readInputs, 'function');
  assert.equal(typeof U.gcal_status, 'function');
  assert.deepEqual(plain(U.EXTENSION_HOOKS.filter((hook) => U.extensionHooks(hook).length)), ['readInputs', 'status']);
  assert.equal(U.extensionInstalled('GCal'), true);
  assert.equal(typeof U.gcal_afterRun, 'undefined', 'the adapter hooks come with the next ticket');
});

test('storage: gcal.csv and the gcal option, header required, never a rotation', () => {
  const storage = new CsvDirStorage(FIXTURE);
  const rows = plain(storage.readGCal());
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0], ['team', '', 'Shared team calendar: all-day events nobody is invited to']);
  assert.deepEqual(Object.keys(storage.readLedgers()), ['primary', 'secondary']);
  assert.deepEqual(storage.ignoredTabs(), []);
  assert.deepEqual(plain(new CsvDirStorage(path.join(__dirname, 'fixtures', 'steady')).readGCal()), []);
  const mem = new MemoryStorage({ gcal: TEAM });
  assert.deepEqual(mem.readGCal(), TEAM);
  assert.deepEqual(new MemoryStorage().readGCal(), []);
  // A storage without readGCal (the Sheets adapter before its ticket) yields no presets.
  assert.deepEqual(plain(U.gcal_readInputs({})), { presets: [], errors: [] });
});

test('presets: fixture parses into two presets with defaults filled', () => {
  const { presets, errors } = plain(U.parseGCalPresets(new CsvDirStorage(FIXTURE).readGCal()));
  assert.deepEqual(errors, []);
  assert.deepEqual(presets.map((p) => p.name), ['team', 'personal']);
  assert.deepEqual(presets[0], {
    name: 'team', note: 'Shared team calendar: all-day events nobody is invited to', row: 2, errors: [],
    id: 'team@group.calendar.google.com', title: '{rotation}: {who}', body: 'Rotalator shift {rotation} {start} to {end}. {note}',
    allday: 'auto', color: 1, free: true, invite: false, reminders: [1440, 60],
  });
  assert.deepEqual(presets[1], {
    name: 'personal', note: 'Timed events on the on-call calendar; members with an email id are invited', row: 8, errors: [],
    id: 'oncall@example.com', title: 'On call: {who} ({start:%a %e %b} to {end:%a %e %b})', body: '{note}',
    allday: false, color: null, free: false, invite: true, reminders: [],
  });
  assert.equal(U.gcalPreset({ presets }, 'personal').id, 'oncall@example.com');
  assert.equal(U.gcalPreset({ presets }, 'nope'), null);
  assert.equal(U.gcalPreset(null, 'team'), null);
});

test('presets: every error, presets with errors are kept but unusable', () => {
  const rows = [
    G('', 'id', 'early@example.com'),
    G('bad name', '', ''),
    G('', 'id', 'x'),
    G('team', '', ''),
    G('', 'id', 'team@example.com'),
    G('', 'colour', 'red'),
    G('', 'id', 'again'),
    G('', 'allday', 'maybe'),
    G('', 'color', '12'),
    G('', 'free', 'sometimes'),
    G('', 'invite', ''),
    G('', 'reminders', '1d, 2sl'),
    G('', 'title', '{who} {what} {start:%Q %q %Q}'),
    G('team', '', 'second'),
    G('', 'id', 'dup@example.com'),
    G('noid', '', ''),
    G('', 'body', 'plain'),
    G('ok', '', ''),
    G('', 'id', 'ok@example.com'),
    G('', 'color', 'Pale-Red'),
    G('', 'reminders', '0'),
    G('', 'allday', 'TRUE'),
  ];
  const out = plain(U.parseGCalPresets(rows));
  assert.deepEqual(out.errors, [
    { where: '#GCal row 2', message: 'setting "id" before any preset' },
    { where: '#GCal row 3', message: 'bad preset name "bad name"; use letters, digits, - and _ without spaces' },
    { where: '#GCal row 7', message: 'unknown setting "colour"' },
    { where: '#GCal row 8', message: 'duplicate setting "id"' },
    { where: '#GCal row 9', message: 'bad value for allday: "maybe"; use auto, true or false' },
    { where: '#GCal row 10', message: 'bad value for color: "12"; use a Calendar colour name like pale blue, or 1 to 11' },
    { where: '#GCal row 11', message: 'bad value for free: "sometimes"; use true or false' },
    { where: '#GCal row 12', message: 'bad value for invite: ""; use true or false' },
    { where: '#GCal row 13', message: 'bad value for reminders: "1d, 2sl"; use comma-separated clock intervals like 1d, 2h, 30m' },
    { where: '#GCal row 14', message: 'unknown placeholder {what} in title' },
    { where: '#GCal row 14', message: 'unknown directive %Q in title' },
    { where: '#GCal row 14', message: 'unknown directive %q in title' },
    { where: '#GCal row 15', message: 'duplicate preset "team"' },
    { where: '#GCal row 17', message: 'preset "noid" has no id' },
  ]);
  // The duplicate is charged to the second team preset; the first collects its ten setting errors.
  assert.deepEqual(out.presets.map((p) => [p.name, p.errors.length]), [['bad name', 1], ['team', 10], ['team', 1], ['noid', 1], ['ok', 0]]);
  assert.equal(out.presets[1].title, '{who} {what} {start:%Q %q %Q}', 'a template with unknown parts is kept verbatim');
  assert.deepEqual(out.presets[3].errors, ['no id']);
  const ok = out.presets[4];
  assert.equal(ok.color, 4);
  assert.deepEqual(ok.reminders, [0]);
  assert.equal(ok.allday, true);
  assert.equal(U.gcalParseColor('GRAY'), 8);
  assert.equal(U.gcalParseColor('pale_green'), 2);
  assert.equal(U.gcalParseColor('11'), 11);
  assert.equal(U.gcalParseColor('0'), null);
  assert.equal(U.gcalParseColor('purple'), null);
  assert.deepEqual(plain(U.gcalParseReminders('30m; 1h30m')), [30, 90]);
  assert.deepEqual(plain(U.gcalParseReminders('')), []);
  assert.equal(U.gcalParseReminders('soon'), null);
  assert.deepEqual(plain(U.parseGCalPresets([])), { presets: [], errors: [] });
  assert.deepEqual(plain(U.parseGCalPresets([G('', '', 'just a comment'), G('', '', '')])), { presets: [], errors: [] });
});

test('strftime subset and templates', () => {
  const t = dt('2026-10-05T09:07');
  const f = (fmt, at = t) => U.gcalStrftime(fmt, at).text;
  assert.equal(f('%Y-%m-%d %H:%M'), '2026-10-05 09:07');
  assert.equal(f('%e|%a|%A|%b|%B|%j|%u|%%'), '5|Mon|Monday|Oct|October|278|1|%');
  assert.equal(f('%a %u %j', dt('2026-01-04')), 'Sun 7 004');
  assert.equal(f('%B %e', dt('2026-02-28T23:59')), 'February 28');
  const odd = U.gcalStrftime('%q and %d%', t);
  assert.equal(odd.text, '%q and 05%');
  assert.deepEqual(plain(odd.unknown), ['%q', '%'], 'a trailing % is reported');

  const values = { who: 'alice', rotation: 'primary', note: 'swap', pin: 'x', start: dt('2026-10-05'), end: dt('2026-10-12T09:00') };
  const out = U.gcalFormat('{rotation}: {who} [{pin}] {start} to {end} ({start:%a %e %b}-{end:%a %e %b %H:%M}) {note} {nope} {start:%Z}', values);
  assert.equal(out.text, 'primary: alice [x] 2026-10-05 to 2026-10-12T09:00 (Mon 5 Oct-Mon 12 Oct 09:00) swap {nope} %Z');
  assert.deepEqual(plain(out.unknown), ['{nope}', '%Z']);
  assert.equal(U.gcalFormat('{note}|{pin}', { note: null }).text, '|');
  assert.equal(U.gcalFormat('no placeholders {} {Who} {START:%d}', values).text, 'no placeholders {} alice 05', 'names are case-insensitive');
  assert.deepEqual(plain(U.gcalTemplateErrors('{Nope} {end:%}', 'title')), ['unknown placeholder {Nope} in title', 'unknown directive % in title']);
  assert.deepEqual(plain(U.gcalTemplateErrors('{a} {a} {start:%q%q} {b}', 'body')), ['unknown placeholder {a} in body', 'unknown directive %q in body', 'unknown placeholder {b} in body']);
  assert.deepEqual(plain(U.gcalTemplateErrors(U.GCAL_DEFAULT_TITLE, 'title')), []);
  assert.deepEqual(plain(U.gcalTemplateErrors(U.GCAL_DEFAULT_BODY, 'body')), []);
});

test('plan: golden fixture, repair window, rotation filter', () => {
  const result = runDir(FIXTURE);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.status.warnings, [], 'the extension is installed, so no warning');
  assert.deepEqual(Object.keys(result.ext), ['gcal']);
  assert.equal(result.ext.gcal.presets.length, 2);
  const plan = plain(U.gcalPlan(result, result.ext.gcal, {}));
  assert.deepEqual(plan, JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected', 'gcal.json'), 'utf8')));
  assert.deepEqual(plan.events.map((e) => [e.key, e.preset]), [
    ['primary|2026-09-28', 'team'], ['primary|2026-09-28', 'personal'],
    ['primary|2026-10-05', 'team'], ['primary|2026-10-05', 'personal'],
    ['primary|2026-10-19', 'team'], ['primary|2026-10-19', 'personal'],
  ]);
  assert.equal(U.gcalEventKey('primary', dt('2026-10-05T09:30')), 'primary|2026-10-05T09:30');

  const repair = plain(U.gcalPlan(result, result.ext.gcal, { repair: true }));
  assert.deepEqual(repair.rotations[0], { rotation: 'primary', presets: ['team', 'personal'], calendars: ['team@group.calendar.google.com', 'oncall@example.com'], from: '2026-09-14', to: '2026-10-26', shifts: 5, skipped: 1 });
  assert.equal(repair.events.length, 10);
  assert.deepEqual(repair.events.slice(0, 2).map((e) => e.title), ['primary: alice', 'On call: alice (Mon 14 Sep to Mon 21 Sep)']);
  assert.deepEqual(plain(U.gcalPlan(result, result.ext.gcal, { rotations: ['secondary'] })), { rotations: [], events: [], errors: [] });
  assert.deepEqual(plain(U.gcalPlan(result, result.ext.gcal, { rotations: ['primary'] })).events.length, 6);
  // Only regenerated rotations are planned: with a rotations option on the run, primary is read but not written.
  const partial = runDir(FIXTURE, null, { rotations: ['secondary'] });
  assert.deepEqual(plain(U.gcalPlan(partial, partial.ext.gcal, {})).rotations, []);
});

test('plan: first run window, timed shifts, unknown and broken presets, no status', () => {
  const gcal = [G('', 'id', 'x')];
  const rows = [G('team', '', ''), G('', 'id', 'team@example.com'), G('', 'title', '{who} {start:%H:%M}'), G('broken', '', ''), G('', 'id', 'b'), G('', 'free', 'nah')];
  const storage = new MemoryStorage({ ledgers: ledger(BASE + ', cal=team broken nope'), gcal: rows });
  const result = runStorage(storage, NOW);
  assert.deepEqual(result.errors, []);
  const plan = plain(U.gcalPlan(result, result.ext.gcal));
  assert.deepEqual(plan.errors, [
    { where: '#GCal row 7', message: 'bad value for free: "nah"; use true or false' },
    { where: 'primary', message: 'preset "broken" skipped: bad value for free: "nah"; use true or false' },
    { where: 'primary', message: 'unknown preset "nope" in cal; add it to #GCal' },
  ]);
  // No stored snapshot: the window starts at the first shift; 09:00 shifts are timed under allday=auto.
  assert.deepEqual(plan.rotations, [{ rotation: 'primary', presets: ['team'], calendars: ['team@example.com'], from: '2026-10-05T09:00', to: '2026-10-19T09:00', shifts: 2, skipped: 0 }]);
  assert.deepEqual(plan.events.map((e) => [e.title, e.start, e.end, e.allDay, e.guests, e.body]), [
    ['alice 09:00', '2026-10-05T09:00', '2026-10-12T09:00', false, [], 'Rotalator shift primary 2026-10-05T09:00 to 2026-10-12T09:00.'],
    ['bob 09:00', '2026-10-12T09:00', '2026-10-19T09:00', false, [], 'Rotalator shift primary 2026-10-12T09:00 to 2026-10-19T09:00.'],
  ]);
  assert.equal(result.status.rotations[0].previousAt, null);
  // A rotation without cal plans nothing; input errors are still reported.
  const none = runStorage(new MemoryStorage({ ledgers: ledger(BASE), gcal: rows }), NOW);
  assert.deepEqual(plain(U.gcalPlan(none, none.ext.gcal)), { rotations: [], events: [], errors: [{ where: '#GCal row 7', message: 'bad value for free: "nah"; use true or false' }] });
  // Without a status (bad now) or a validation error the plan is empty.
  const bad = runStorage(new MemoryStorage({ ledgers: ledger(BASE), gcal }), 'someday');
  assert.deepEqual(plain(U.gcalPlan(bad, bad.ext.gcal)), { rotations: [], events: [], errors: [{ where: '#GCal row 2', message: 'setting "id" before any preset' }] });
  assert.deepEqual(plain(U.gcalPlan(null, null)), { rotations: [], events: [], errors: [] });
});

test('clean plan: every key of a rotation, or a whole calendar', () => {
  const result = runDir(FIXTURE);
  const clean = plain(U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'primary' }));
  assert.deepEqual(clean, {
    rotation: 'primary',
    calendars: ['team@group.calendar.google.com', 'oncall@example.com'],
    from: '2026-09-14',
    to: '2026-10-26',
    keys: ['primary|2026-09-14', 'primary|2026-09-21', 'primary|2026-09-28', 'primary|2026-10-05', 'primary|2026-10-12', 'primary|2026-10-19'],
    errors: [],
  });
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'secondary' })).calendars, []);
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'nope' })), { error: 'unknown rotation "nope"' });
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { preset: 'team' })), { preset: 'team', calendar: 'team@group.calendar.google.com', all: true });
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { preset: 'x' })), { error: 'unknown preset "x"' });
});

test('status block: data from the plan, rows through the core hook', () => {
  const result = runDir(FIXTURE);
  const plan = U.gcalPlan(result, result.ext.gcal, {});
  const data = plain(U.gcalStatusData(plan));
  assert.deepEqual(data, { lines: [
    { rotation: 'primary', preset: 'team', calendar: 'team@group.calendar.google.com', create: 0, update: 0, delete: 0, unchanged: 0, skipped: 1 },
    { rotation: 'primary', preset: 'personal', calendar: 'oncall@example.com', create: 0, update: 0, delete: 0, unchanged: 0, skipped: 1 },
  ], errors: [] });
  assert.equal(U.gcal_status(result.status), null, 'nothing without status.ext.gcal');
  const without = U.statusRows(result.status).rows.length;
  data.lines[0].create = 3;
  data.errors.push({ where: 'primary', message: 'calendar not found' });
  data.mode = 'dry run';
  result.status.ext = { gcal: data };
  const block = plain(U.gcal_status(result.status));
  assert.deepEqual(plain(U.gcal_status({ ext: { gcal: { lines: [] } } })), { rows: [['Calendar'], ['rotation', 'preset', 'calendar', 'create', 'update', 'delete', 'unchanged', 'skipped']], headerRows: [0, 1] }, 'errors may be omitted');
  assert.deepEqual(block, { rows: [
    ['Calendar (dry run)'],
    ['rotation', 'preset', 'calendar', 'create', 'update', 'delete', 'unchanged', 'skipped'],
    ['primary', 'team', 'team@group.calendar.google.com', '3', '0', '0', '0', '1'],
    ['primary', 'personal', 'oncall@example.com', '0', '0', '0', '0', '1'],
    ['calendar errors', 'where', 'message'],
    ['', 'primary', 'calendar not found'],
  ], headerRows: [0, 1, 4] });
  const rows = plain(U.statusRows(result.status));
  assert.equal(rows.rows.length, without + 7);
  assert.deepEqual(rows.rows[without + 1].slice(0, 1), ['Calendar (dry run)']);
  assert.deepEqual(rows.headerRows.slice(-3), [without + 1, without + 2, without + 5]);
  assert.match(statusText(result.status), /\nCalendar \(dry run\)\nrotation +preset +calendar +create +update +delete +unchanged +skipped\nprimary +team +team@group.calendar.google.com +3 +0 +0 +0 +1\n/);
});
