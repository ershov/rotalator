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
  assert.deepEqual(plain(U.EXTENSION_HOOKS.filter((hook) => U.extensionHooks(hook).length)), ['menu', 'setup', 'setupTab', 'help', 'readInputs', 'afterRun', 'status']);
  assert.equal(U.extensionInstalled('GCal'), true);
});

test('storage: readTabRows for gcal.csv and the tabs option, header required, never a rotation', () => {
  const storage = new CsvDirStorage(FIXTURE);
  const rows = plain(storage.readTabRows(U.GCAL_TAB, U.GCAL_HEADER));
  assert.equal(rows.length, 12);
  assert.deepEqual(rows[0], ['team', '', 'Shared team calendar: all-day events nobody is invited to']);
  assert.deepEqual(plain(storage.readTabRows(U.GCAL_TAB, ['other', 'header'])), [], 'header must match');
  assert.deepEqual(Object.keys(storage.readLedgers()), ['primary', 'secondary']);
  assert.deepEqual(storage.ignoredTabs(), []);
  assert.deepEqual(plain(new CsvDirStorage(path.join(__dirname, 'fixtures', 'steady')).readTabRows(U.GCAL_TAB, U.GCAL_HEADER)), []);
  const mem = new MemoryStorage({ tabs: { '#GCal': TEAM } });
  assert.deepEqual(mem.readTabRows('#GCal', U.GCAL_HEADER), TEAM);
  assert.deepEqual(new MemoryStorage().readTabRows('#GCal', U.GCAL_HEADER), []);
  // A storage without readTabRows yields no presets.
  assert.deepEqual(plain(U.gcal_readInputs({})), { presets: [], errors: [], rows: [] });
});

test('presets: fixture parses into two presets with defaults filled', () => {
  const { presets, errors } = plain(U.parseGCalPresets(new CsvDirStorage(FIXTURE).readTabRows(U.GCAL_TAB, U.GCAL_HEADER)));
  assert.deepEqual(errors, []);
  assert.deepEqual(presets.map((p) => p.name), ['team', 'personal']);
  assert.deepEqual(presets[0], {
    name: 'team', note: 'Shared team calendar: all-day events nobody is invited to', row: 2, setRows: { id: 3, color: 4, invite: 5, reminders: 6 }, errors: [],
    id: 'team@group.calendar.google.com', title: '{rotation}: {who}', body: 'Rotalator shift {rotation} {start} to {end}. {note}',
    allday: 'auto', color: 1, free: true, invite: false, reminders: [1440, 60],
  });
  assert.deepEqual(presets[1], {
    name: 'personal', note: 'Timed events on the on-call calendar; members with an email id are invited', row: 8, setRows: { id: 9, title: 10, body: 11, allday: 12, free: 13 }, errors: [],
    id: 'oncall@example.com', title: 'On call: {who} ({start:%a %e %b} to {end:%a %e %b})', body: '{note}',
    allday: false, color: 'default', free: false, invite: true, reminders: [],
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
    { row: 2, where: '#GCal row 3', message: 'setting "id" before any preset' },
    { row: 3, where: '#GCal row 5', message: 'bad preset name "bad name"; use letters, digits, - and _ without spaces' },
    { row: 7, where: '#GCal row 10', message: 'unknown setting "colour"' },
    { row: 8, where: '#GCal row 12', message: 'duplicate setting "id"' },
    { row: 9, where: '#GCal row 14', message: 'bad value for allday: "maybe"; use auto, true or false' },
    { row: 10, where: '#GCal row 16', message: 'bad value for color: "12"; use default (the calendar\'s own colour), a Calendar colour name like pale blue, its number 1 to 11, or #RRGGBB (the nearest colour is used)' },
    { row: 11, where: '#GCal row 18', message: 'bad value for free: "sometimes"; use true or false' },
    { row: 12, where: '#GCal row 20', message: 'bad value for invite: ""; use true or false' },
    { row: 13, where: '#GCal row 22', message: 'bad value for reminders: "1d, 2sl"; use comma-separated clock intervals like 1d, 2h, 30m, or empty for the calendar defaults' },
    { row: 14, where: '#GCal row 26', message: 'unknown placeholder {what} in title' },
    { row: 14, where: '#GCal row 26', message: 'unknown directive %Q in title' },
    { row: 14, where: '#GCal row 26', message: 'unknown directive %q in title' },
    { row: 15, where: '#GCal row 28', message: 'duplicate preset "team"' },
    { row: 17, where: '#GCal row 31', message: 'preset "noid" has no id' },
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
  // default (or none) is the calendar's own colour, left alone on the events.
  assert.equal(U.gcalParseColor('default'), 'default');
  assert.equal(U.gcalParseColor('NONE'), 'default');
  assert.equal(U.GCAL_SETTINGS.color.def, 'default');
  // #RRGGBB maps to the nearest palette colour by RGB distance.
  assert.equal(U.gcalParseColor('#a4bdfc'), 1);
  assert.equal(U.gcalParseColor('#A4BDFC'), 1);
  assert.equal(U.gcalParseColor('#ff0000'), 11);
  assert.equal(U.gcalParseColor('#FFFFFF'), 8);
  assert.equal(U.gcalParseColor('#000000'), 10);
  assert.equal(U.gcalParseColor('#dbadff'), 3);
  assert.equal(U.gcalParseColor('#12345'), null);
  assert.equal(U.gcalParseColor('a4bdfc'), null, 'the # is required');
  assert.equal(U.gcalParseColor('#a4bdfg'), null);
  assert.deepEqual(Object.keys(plain(U.GCAL_COLOR_RGB)), Object.keys(plain(U.GCAL_COLORS)));
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
  assert.deepEqual(repair.rotations[0], { rotation: 'primary', presets: ['team', 'personal'], calendars: ['team@group.calendar.google.com', 'oncall@example.com'], from: '2026-09-14', to: '2026-10-26', until: '2029-10-04T10:00', shifts: 5, skipped: 1 });
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
  const storage = new MemoryStorage({ ledgers: ledger(BASE + ', cal=team broken nope'), tabs: { '#GCal': rows } });
  const result = runStorage(storage, NOW);
  // The extension's plan errors count as errors of the run (toast, stderr).
  assert.deepEqual(result.errors, [
    'GCal #GCal row 8: bad value for free: "nah"; use true or false',
    'GCal primary: preset "broken" skipped: bad value for free: "nah"; use true or false',
    'GCal primary: unknown preset "nope" in cal; add it to #GCal',
  ]);
  const plan = plain(U.gcalPlan(result, result.ext.gcal));
  assert.deepEqual(plan.errors, [
    { row: 7, where: '#GCal row 8', message: 'bad value for free: "nah"; use true or false' },
    { where: 'primary', rotation: 'primary', message: 'preset "broken" skipped: bad value for free: "nah"; use true or false' },
    { where: 'primary', rotation: 'primary', setting: 'cal', message: 'unknown preset "nope" in cal; add it to #GCal' },
  ]);
  // No stored snapshot: the window starts at the first shift; 09:00 shifts are timed under allday=auto.
  assert.deepEqual(plan.rotations, [{ rotation: 'primary', presets: ['team'], calendars: ['team@example.com'], from: '2026-10-05T09:00', to: '2026-10-19T09:00', until: '2029-10-04T10:00', shifts: 2, skipped: 0 }]);
  assert.deepEqual(plan.events.map((e) => [e.title, e.start, e.end, e.allDay, e.guests, e.body]), [
    ['alice 09:00', '2026-10-05T09:00', '2026-10-12T09:00', false, [], 'Rotalator shift primary 2026-10-05T09:00 to 2026-10-12T09:00.'],
    ['bob 09:00', '2026-10-12T09:00', '2026-10-19T09:00', false, [], 'Rotalator shift primary 2026-10-12T09:00 to 2026-10-19T09:00.'],
  ]);
  assert.equal(result.status.rotations[0].previousAt, null);
  // A rotation without cal plans nothing; input errors are still reported.
  const none = runStorage(new MemoryStorage({ ledgers: ledger(BASE), tabs: { '#GCal': rows } }), NOW);
  assert.deepEqual(plain(U.gcalPlan(none, none.ext.gcal)), { rotations: [], events: [], errors: [{ row: 7, where: '#GCal row 8', message: 'bad value for free: "nah"; use true or false' }] });
  // Without a status (bad now) or a validation error the plan is empty.
  const bad = runStorage(new MemoryStorage({ ledgers: ledger(BASE), tabs: { '#GCal': gcal } }), 'someday');
  assert.deepEqual(plain(U.gcalPlan(bad, bad.ext.gcal)), { rotations: [], events: [], errors: [{ row: 2, where: '#GCal row 3', message: 'setting "id" before any preset' }] });
  assert.deepEqual(plain(U.gcalPlan(null, null)), { rotations: [], events: [], errors: [] });
  // Two presets on one calendar: the second is skipped, its events would share the first one's keys.
  const shared = [G('a', '', ''), G('', 'id', 'same@example.com'), G('b', '', ''), G('', 'id', 'same@example.com')];
  const twice = runStorage(new MemoryStorage({ ledgers: ledger(BASE + ', cal=a b'), tabs: { '#GCal': shared } }), NOW);
  const twicePlan = plain(U.gcalPlan(twice, twice.ext.gcal));
  assert.deepEqual(twicePlan.rotations[0].presets, ['a']);
  assert.deepEqual(twicePlan.errors, [{ where: 'primary', rotation: 'primary', setting: 'cal', message: 'preset "b" skipped: calendar same@example.com is already used by preset "a"' }]);
});

test('clean plan: every key of a rotation, or a whole calendar', () => {
  const result = runDir(FIXTURE);
  const clean = plain(U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'primary' }));
  assert.deepEqual(clean, {
    rotation: 'primary',
    calendars: ['team@group.calendar.google.com', 'oncall@example.com'],
    from: '2026-09-14',
    to: '2029-10-04T10:00',
    keys: ['primary|2026-09-14', 'primary|2026-09-21', 'primary|2026-09-28', 'primary|2026-10-05', 'primary|2026-10-12', 'primary|2026-10-19'],
    errors: [],
  });
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'secondary' })).calendars, []);
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'nope' })), { error: 'unknown rotation "nope"' });
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { preset: 'team' })), { preset: 'team', calendar: 'team@group.calendar.google.com', all: true });
  assert.deepEqual(plain(U.gcalCleanPlan(result, result.ext.gcal, { preset: 'x' })), { error: 'unknown preset "x"' });
  const broken = U.parseGCalPresets([G('noid', '', '')]);
  assert.deepEqual(plain(U.gcalCleanPlan(null, broken, { preset: 'noid' })), { error: 'preset "noid" has errors: no id' });
});

test('status block: data from the plan, rows through the core hook', () => {
  const result = runDir(FIXTURE);
  const plan = U.gcalPlan(result, result.ext.gcal, {});
  const data = plain(U.gcalStatusData(plan));
  assert.deepEqual(data, { lines: [
    { rotation: 'primary', preset: 'team', calendar: 'team@group.calendar.google.com', create: 0, update: 0, delete: 0, unchanged: 0, skipped: 1 },
    { rotation: 'primary', preset: 'personal', calendar: 'oncall@example.com', create: 0, update: 0, delete: 0, unchanged: 0, skipped: 1 },
  ], errors: [] });
  // In Node the afterRun hook records the plan without a calendar; no guarded run, so elapsed is 0.
  assert.deepEqual(plain(result.status.ext.gcal), { ...data, mode: 'no calendar', elapsed: 0 });
  assert.deepEqual(plain(U.gcal_status(result.status)).rows[0], ['Calendar (no calendar)', 'elapsed', '0 s']);
  delete result.status.ext;
  assert.equal(U.gcal_status(result.status), null, 'nothing without status.ext.gcal');
  const without = U.statusRows(result.status).rows.length;
  data.lines[0].create = 3;
  data.errors.push({ where: 'primary', message: 'calendar not found' });
  data.mode = 'dry run';
  result.status.ext = { gcal: data };
  const block = plain(U.gcal_status(result.status));
  assert.deepEqual(plain(U.gcal_status({ ext: { gcal: { lines: [] } } })), { rows: [['Calendar'], ['rotation', 'preset', 'calendar', 'create', 'update', 'delete', 'unchanged', 'skipped']], headerRows: [0, 1], errorRows: [], warningRows: [] }, 'errors may be omitted');
  assert.deepEqual(block, { rows: [
    ['Calendar (dry run)'],
    ['rotation', 'preset', 'calendar', 'create', 'update', 'delete', 'unchanged', 'skipped'],
    ['primary', 'team', 'team@group.calendar.google.com', '3', '0', '0', '0', '1'],
    ['primary', 'personal', 'oncall@example.com', '0', '0', '0', '0', '1'],
    ['calendar errors', 'where', 'message'],
    ['', 'primary', 'calendar not found'],
  ], headerRows: [0, 1, 4], errorRows: [5], warningRows: [] });
  // The core maps the block's error rows into its own metadata.
  const painted = plain(U.statusRows(result.status));
  assert.deepEqual(painted.errorRows, [painted.rows.length - 1]);
  assert.deepEqual(painted.warningRows, []);
  // Elapsed seconds go on the title row; a stop note is a warning of the run, not a row of the block.
  data.elapsed = 42;
  data.note = 'aborted after 3 event(s)';
  const noted = plain(U.gcal_status(result.status));
  assert.deepEqual(noted.rows[0], ['Calendar (dry run)', 'elapsed', '42 s']);
  assert.equal(noted.rows.length, 6);
  assert.ok(!noted.rows.some((r) => r[0] === 'note'));
  assert.deepEqual(noted.headerRows, [0, 1, 4]);
  delete data.elapsed;
  delete data.note;
  const rows = plain(U.statusRows(result.status));
  assert.equal(rows.rows.length, without + 7);
  assert.deepEqual(rows.rows[without + 1].slice(0, 1), ['Calendar (dry run)']);
  assert.deepEqual(rows.headerRows.slice(-3), [without + 1, without + 2, without + 5]);
  assert.match(statusText(result.status), /\nCalendar \(dry run\)\nrotation +preset +calendar +create +update +delete +unchanged +skipped\nprimary +team +team@group.calendar.google.com +3 +0 +0 +0 +1\n/);
});

// Mock of the CalendarApp and Utilities surface the adapter uses; tz is treated as UTC. Every mutation is
// logged in calendar.writes so a reconcile of an unchanged schedule can be shown to write nothing.
class MockEvent {
  constructor(calendar, title, start, end, allDay, options = {}) {
    this.calendar = calendar;
    this.title = title; this.start = start; this.end = end; this.allDay = allDay;
    this.description = options.description || '';
    this.guests = options.guests ? options.guests.split(',') : [];
    this.invitesSent = Boolean(options.sendInvites);
    this.tags = {}; this.color = ''; this.transparency = 'OPAQUE'; this.reminders = [10]; this.deleted = false;
  }
  log(what) { this.calendar.writes.push(`${this.tags.rotalator || this.title}:${what}`); }
  getTitle() { return this.title; }
  setTitle(t) { this.title = t; this.log('title'); }
  getDescription() { return this.description; }
  setDescription(d) { this.description = d; this.log('description'); }
  isAllDayEvent() { return this.allDay; }
  getStartTime() { return this.start; }
  getEndTime() { return this.end; }
  getAllDayStartDate() { return this.start; }
  getAllDayEndDate() { return this.end; }
  setTime(s, e) { this.start = s; this.end = e; this.allDay = false; this.log('time'); }
  setAllDayDates(s, e) { this.start = s; this.end = e; this.allDay = true; this.log('alldays'); }
  getColor() { return this.color; }
  setColor(c) { this.color = c; this.log('color'); }
  getTransparency() { return this.transparency; }
  setTransparency(t) { this.transparency = t; this.log('transparency'); }
  getGuestList() { return this.guests.map((g) => ({ getEmail: () => g })); }
  addGuest(g) { this.guests.push(g); this.log(`addGuest ${g}`); }
  removeGuest(g) { this.guests = this.guests.filter((x) => x !== g); this.log(`removeGuest ${g}`); }
  getPopupReminders() { return this.reminders.slice(); }
  removeAllReminders() { this.reminders = []; this.log('removeReminders'); }
  addPopupReminder(m) { this.reminders.push(m); this.log(`reminder ${m}`); }
  getTag(k) { return this.tags[k] ?? null; }
  setTag(k, v) { this.tags[k] = v; this.log(`tag ${v}`); }
  deleteEvent() { this.deleted = true; this.log('delete'); }
}
class MockCalendar {
  constructor(id) { this.id = id; this.events = []; this.writes = []; this.failing = false; }
  getEvents(s, e) {
    if (this.failing) throw new Error('API quota');
    return this.events.filter((ev) => !ev.deleted && ev.start < e && ev.end > s);
  }
  add(title, start, end, allDay, key, options) {
    const ev = new MockEvent(this, title, new Date(start), new Date(end), allDay, options);
    if (key) ev.tags.rotalator = key;
    this.events.push(ev);
    return ev;
  }
  createEvent(t, s, e, o) { this.writes.push(`create ${t}`); return this.add(t, s, e, false, null, o); }
  createAllDayEvent(t, s, e, o) { this.writes.push(`createAllDay ${t}`); return this.add(t, s, e, true, null, o); }
  live() { return this.events.filter((ev) => !ev.deleted); }
}
const COLORS = { PALE_BLUE: '1', PALE_GREEN: '2', MAUVE: '3', PALE_RED: '4', YELLOW: '5', ORANGE: '6', CYAN: '7', GRAY: '8', BLUE: '9', GREEN: '10', RED: '11' };
// Zones the mock Utilities knows, as offsets in minutes; the script zone comes from Session.
const ZONES = { UTC: 0, Plus10: 600, Minus5: -300 };
function installMocks(ids, scriptZone = 'UTC') {
  const calendars = {};
  ids.forEach((id) => { calendars[id] = new MockCalendar(id); });
  U.CalendarApp = { getCalendarById: (id) => calendars[id] || null, EventColor: COLORS, EventTransparency: { OPAQUE: 'OPAQUE', TRANSPARENT: 'TRANSPARENT' } };
  U.Utilities = {
    parseDate: (text, tz) => new Date(new Date(text + ':00Z').getTime() - ZONES[tz] * 60000),
    formatDate: (d, tz) => new Date(d.getTime() + ZONES[tz] * 60000).toISOString().slice(0, 16),
  };
  U.Session = { getScriptTimeZone: () => scriptZone };
  return calendars;
}
function removeMocks() { delete U.CalendarApp; delete U.Utilities; delete U.Session; }
const TEAM_CAL = 'team@group.calendar.google.com';
const PERSONAL_CAL = 'oncall@example.com';
const iso = (d) => d.toISOString().slice(0, 16);

test('reconcile: create, unchanged without writes, update only what differs, delete stale, leave others', () => {
  const calendars = installMocks([TEAM_CAL, PERSONAL_CAL]);
  try {
    const result = runDir(FIXTURE, null, { export: false });
    const plan = U.gcalPlan(result, result.ext.gcal, {});
    const team = calendars[TEAM_CAL], personal = calendars[PERSONAL_CAL];
    // Pre-existing: an untagged event, another rotation's event, a stale event of primary inside the window,
    // and an event of a shift before the window, all in the team calendar.
    team.add('standup', '2026-10-01T09:00', '2026-10-01T09:30', false, null);
    team.add('other', '2026-10-05', '2026-10-12', true, 'secondary|2026-10-05');
    const stale = team.add('primary: zed', '2026-10-12', '2026-10-19', true, 'primary|2026-10-12');
    const history = team.add('primary: bob', '2026-09-21', '2026-09-28', true, 'primary|2026-09-21');
    const data = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC' });
    assert.deepEqual(plain(data.errors), []);
    assert.deepEqual(plain(data.lines).map((l) => [l.preset, l.create, l.update, l.delete, l.unchanged, l.skipped]), [['team', 3, 0, 1, 0, 1], ['personal', 3, 0, 0, 0, 1]]);
    assert.equal(stale.deleted, true);
    assert.equal(history.deleted, false);
    assert.equal(team.live().length, 6);
    const created = team.live().filter((ev) => ev.tags.rotalator?.startsWith('primary|') && ev !== history);
    assert.deepEqual(created.map((ev) => [ev.title, iso(ev.start), iso(ev.end), ev.allDay, ev.color, ev.transparency, ev.guests, ev.reminders, ev.invitesSent]), [
      ['primary: carol', '2026-09-28T00:00', '2026-10-05T00:00', true, '1', 'TRANSPARENT', [], [1440, 60], false],
      ['primary: dave@example.com', '2026-10-05T00:00', '2026-10-12T00:00', true, '1', 'TRANSPARENT', [], [1440, 60], false],
      ['primary: alice', '2026-10-19T00:00', '2026-10-26T00:00', true, '1', 'TRANSPARENT', [], [1440, 60], false],
    ]);
    assert.equal(created[0].description, 'Rotalator shift primary 2026-09-28 to 2026-10-05. volunteered');
    const timed = personal.live();
    // personal sets no reminders: the events keep the calendar default (10 in the mock) and no reminder call is made.
    assert.deepEqual(timed.map((ev) => [ev.title, ev.allDay, ev.color, ev.transparency, ev.guests, ev.invitesSent, ev.reminders]), [
      ['On call: carol (Mon 28 Sep to Mon 5 Oct)', false, '', 'OPAQUE', [], false, [10]],
      ['On call: dave@example.com (Mon 5 Oct to Mon 12 Oct)', false, '', 'OPAQUE', ['dave@example.com'], true, [10]],
      ['On call: alice (Mon 19 Oct to Mon 26 Oct)', false, '', 'OPAQUE', [], false, [10]],
    ]);
    assert.ok(!personal.writes.some((w) => /remind/i.test(w)), 'no reminder calls for an empty list');
    // Same plan again: everything unchanged, not a single write.
    team.writes = []; personal.writes = [];
    const again = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC' });
    assert.deepEqual(plain(again.lines).map((l) => [l.create, l.update, l.delete, l.unchanged]), [[0, 0, 0, 3], [0, 0, 0, 3]]);
    assert.deepEqual(team.writes.concat(personal.writes), []);
    // A changed plan: new assignee on 10-05 (title, body, guests), reminders on personal, colour untouched when
    // the preset has none, all-day to timed switch.
    const changed = structuredClone(plan);
    changed.events.forEach((e) => {
      if (e.key === 'primary|2026-10-05') { e.title = e.title.replace('dave@example.com', 'erin@example.com'); e.guests = e.preset === 'personal' ? ['erin@example.com'] : []; }
      if (e.preset === 'personal') e.reminders = [30];
      if (e.key === 'primary|2026-10-19' && e.preset === 'team') { e.allDay = false; e.start = '2026-10-19T09:00'; }
    });
    const updated = U.gcalReconcile(changed, U.gcalStatusData(changed), { tz: 'UTC' });
    assert.deepEqual(plain(updated.lines).map((l) => [l.create, l.update, l.delete, l.unchanged]), [[0, 2, 0, 1], [0, 3, 0, 0]]);
    assert.deepEqual(team.writes, ['primary|2026-10-05:title', 'primary|2026-10-19:time']);
    const dave = personal.live()[1];
    assert.deepEqual(dave.guests, ['erin@example.com']);
    assert.equal(dave.invitesSent, true, 'set on creation only; no new invitation on update');
    assert.deepEqual(personal.writes.filter((w) => w.startsWith('primary|2026-10-05')), ['primary|2026-10-05:title', 'primary|2026-10-05:addGuest erin@example.com', 'primary|2026-10-05:removeGuest dave@example.com', 'primary|2026-10-05:removeReminders', 'primary|2026-10-05:reminder 30']);
    const switched = team.live().find((ev) => ev.tags.rotalator === 'primary|2026-10-19');
    assert.equal(switched.allDay, false);
    assert.equal(iso(switched.start), '2026-10-19T09:00');
    // Duplicates with one key are deleted down to one.
    team.add('dup', '2026-10-05', '2026-10-12', true, 'primary|2026-10-05');
    const dedup = U.gcalReconcile(changed, U.gcalStatusData(changed), { tz: 'UTC' });
    assert.equal(plain(dedup.lines)[0].delete, 1);
    assert.equal(team.live().filter((ev) => ev.tags.rotalator === 'primary|2026-10-05').length, 1);
    // Guest emails compare lower-cased, so a mixed-case id is not re-added every run.
    const cased = structuredClone(changed);
    cased.events.find((e) => e.key === 'primary|2026-10-05' && e.preset === 'personal').guests = ['Erin@Example.com'];
    personal.writes = [];
    assert.equal(plain(U.gcalReconcile(cased, U.gcalStatusData(cased), { tz: 'UTC' }).lines)[1].unchanged, 3);
    assert.deepEqual(personal.writes, []);
    // A shortened horizon: events beyond the new horizon are deleted, up to the clean bound.
    const shorter = structuredClone(changed);
    shorter.rotations[0].to = '2026-10-19';
    shorter.events = shorter.events.filter((e) => e.key !== 'primary|2026-10-19');
    const shrunk = U.gcalReconcile(shorter, U.gcalStatusData(shorter), { tz: 'UTC' });
    assert.deepEqual(plain(shrunk.lines).map((l) => [l.delete, l.unchanged]), [[1, 2], [1, 2]]);
    assert.equal(team.live().some((ev) => ev.tags.rotalator === 'primary|2026-10-19'), false);
    const far = team.add('far', '2030-01-07', '2030-01-14', true, 'primary|2030-01-07');
    U.gcalReconcile(shorter, U.gcalStatusData(shorter), { tz: 'UTC' });
    assert.equal(far.deleted, false, 'beyond the clean bound nothing is touched');
    // Back to an empty reminders list: existing events keep the [30] they have, nothing is written.
    const noReminders = structuredClone(shorter);
    noReminders.events.forEach((e) => { if (e.preset === 'personal') e.reminders = []; });
    personal.writes = [];
    assert.equal(plain(U.gcalReconcile(noReminders, U.gcalStatusData(noReminders), { tz: 'UTC' }).lines)[1].unchanged, 2);
    assert.deepEqual(personal.writes, []);
    assert.deepEqual(personal.live()[0].reminders, [30]);
  } finally { removeMocks(); }
});

test('reconcile: all-day dates in the script zone, timed instants in the spreadsheet zone, converging', () => {
  const calendars = installMocks([TEAM_CAL, PERSONAL_CAL], 'Minus5');
  try {
    const result = runDir(FIXTURE, null, { export: false });
    const plan = U.gcalPlan(result, result.ext.gcal, {});
    const first = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'Plus10' });
    assert.deepEqual(plain(first.errors), []);
    const allDay = calendars[TEAM_CAL].live()[0];
    // Midnight of 2026-09-28 in the script zone (-5) is 05:00Z; the spreadsheet zone plays no part.
    assert.equal(allDay.start.toISOString(), '2026-09-28T05:00:00.000Z');
    assert.equal(allDay.end.toISOString(), '2026-10-05T05:00:00.000Z');
    // A timed event at 00:00 spreadsheet time (+10) is 14:00Z the day before.
    assert.equal(calendars[PERSONAL_CAL].live()[0].start.toISOString(), '2026-09-27T14:00:00.000Z');
    calendars[TEAM_CAL].writes = []; calendars[PERSONAL_CAL].writes = [];
    const again = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'Plus10' });
    assert.deepEqual(plain(again.lines).map((l) => [l.update, l.unchanged]), [[0, 3], [0, 3]]);
    assert.deepEqual(calendars[TEAM_CAL].writes.concat(calendars[PERSONAL_CAL].writes), []);
  } finally { removeMocks(); }
});

test('reconcile: dry run counts without writing; missing calendar and API failure are errors, not exceptions', () => {
  const calendars = installMocks([TEAM_CAL]);
  try {
    const result = runDir(FIXTURE, null, { export: false });
    const plan = U.gcalPlan(result, result.ext.gcal, {});
    const dry = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC', dry: true });
    assert.deepEqual(plain(dry.lines).map((l) => [l.preset, l.create]), [['team', 3], ['personal', 0]]);
    assert.deepEqual(calendars[TEAM_CAL].writes, []);
    assert.deepEqual(plain(dry.errors), [{ where: 'primary / personal', rotation: 'primary', preset: 'personal', message: 'calendar "oncall@example.com" not found or not shared with this account' }]);
    calendars[TEAM_CAL].failing = true;
    const failed = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC' });
    assert.deepEqual(plain(failed.errors).map((e) => e.message), ['API quota', 'calendar "oncall@example.com" not found or not shared with this account']);
  } finally { removeMocks(); }
});

test('clean: a rotation in its calendars by tag prefix, or every tagged event of one calendar', () => {
  const calendars = installMocks([TEAM_CAL, PERSONAL_CAL]);
  try {
    const result = runDir(FIXTURE, null, { export: false });
    const plan = U.gcalPlan(result, result.ext.gcal, { repair: true });
    U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC' });
    const team = calendars[TEAM_CAL];
    team.add('other', '2026-10-05', '2026-10-12', true, 'secondary|2026-10-05');
    team.add('standup', '2026-10-01T09:00', '2026-10-01T09:30', false, null);
    assert.equal(team.live().length, 7);
    const clean = U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'primary' });
    assert.equal(clean.to, '2029-10-04T10:00', 'the clean reaches the clean bound');
    const dryOut = U.gcalClean(clean, { tz: 'UTC', dry: true });
    assert.equal(dryOut.deleted, 10);
    assert.equal(team.live().length, 7);
    const out = plain(U.gcalClean(clean, { tz: 'UTC' }));
    assert.deepEqual(out, { deleted: 10, errors: [], elapsed: 0 });
    assert.deepEqual(team.live().map((ev) => ev.title), ['other', 'standup']);
    assert.equal(calendars[PERSONAL_CAL].live().length, 0);
    const all = U.gcalCleanPlan(null, result.ext.gcal, { preset: 'team' });
    const window = plain(U.gcalCleanWindow(U.parseDateTime(NOW)));
    assert.deepEqual(window, { from: '2025-10-05T10:00', to: '2029-10-04T10:00' });
    assert.deepEqual(plain(U.gcalClean(all, { tz: 'UTC', from: window.from, to: window.to })), { deleted: 1, errors: [], elapsed: 0 });
    assert.deepEqual(team.live().map((ev) => ev.title), ['standup']);
    assert.deepEqual(plain(U.gcalClean({ all: true, calendar: 'nope' }, { tz: 'UTC', from: window.from, to: window.to })).errors.length, 1);
  } finally { removeMocks(); }
});

test('gcal_afterRun: exports through the runner, dry when not writing or on a dry run, skipped on export: false', () => {
  const calendars = installMocks([TEAM_CAL, PERSONAL_CAL]);
  try {
    const storage = new CsvDirStorage(FIXTURE);
    const inputs = { ledgers: storage.readLedgers(), holidays: storage.readHolidays(), global: storage.readGlobal(), tabs: { '#GCal': storage.readTabRows(U.GCAL_TAB, U.GCAL_HEADER) } };
    const dry = runStorage(new MemoryStorage(inputs), storage.readNow(), { write: true, mode: 'dry run' });
    assert.equal(dry.status.ext.gcal.mode, 'dry run');
    assert.deepEqual(dry.status.ext.gcal.lines.map((l) => l.create), [3, 3]);
    assert.equal(calendars[TEAM_CAL].live().length, 0);
    const noWrite = runStorage(new MemoryStorage(inputs), storage.readNow());
    assert.equal(noWrite.status.ext.gcal.mode, 'dry run');
    const skipped = runStorage(new MemoryStorage(inputs), storage.readNow(), { write: true, export: false });
    assert.equal(skipped.status.ext, undefined);
    const mem = new MemoryStorage(inputs);
    const real = runStorage(mem, storage.readNow(), { write: true });
    assert.equal(real.status.ext.gcal.mode, undefined);
    assert.deepEqual(real.status.ext.gcal.lines.map((l) => [l.create, l.skipped]), [[3, 1], [3, 1]]);
    assert.equal(calendars[TEAM_CAL].live().length, 3);
    assert.deepEqual(plain(mem.status.ext.gcal.lines).map((l) => l.create), [3, 3], 'the written status has the block');
    assert.equal(real.status.ext.gcal.elapsed, 0);
    assert.match(statusText(real.status), /\nCalendar +elapsed +0 s\nrotation +preset +calendar +create/);
    // A spreadsheet without cal and without preset errors gets no block.
    const plainRun = runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), NOW, { write: true });
    assert.equal(plainRun.status.ext, undefined);
  } finally { removeMocks(); }
});

test('menu, help and summary', () => {
  const items = [];
  const menu = { addSeparator() { items.push('---'); return this; }, addItem(label, fn) { items.push(`${label} -> ${fn}`); return this; } };
  U.gcal_menu(menu);
  assert.deepEqual(items, ['---', 'Re-export calendar -> gcalReexport', 'Re-export calendar: current rotation -> gcalReexportCurrent', 'Clean calendar: current rotation -> gcalCleanCurrent', 'Clean calendar: selected preset -> gcalCleanPreset']);
  for (const fn of ['gcalReexport', 'gcalReexportCurrent', 'gcalCleanCurrent', 'gcalCleanPreset', 'gcal_setup']) assert.equal(typeof U[fn], 'function', fn);
  const lines = plain(U.helpText());
  assert.equal(lines.length, U.HELP_TEXT.length + U.GCAL_HELP_LINES.length);
  assert.ok(plain(U.helpHeadingRows(lines)).includes(U.HELP_TEXT.length + 1));
  const help = plain(U.GCAL_HELP_LINES);
  for (const key of Object.keys(U.GCAL_SETTINGS)) assert.ok(help.some((l) => l.startsWith(`${key}: `)), key);
  assert.ok(help.some((l) => l.startsWith('TEMPLATES: {who} {rotation} {note} {pin} {start} {end}')));
  assert.ok(help.some((l) => l.startsWith('USE: set cal=<preset> [<preset> ...]')));
  // The #GCal template: header, the cheat sheet as comment rows, then preset-1 to fill in; it parses clean.
  const rows = plain(U.gcalTemplateRows());
  assert.deepEqual(rows[0], ['preset', 'setting', 'value']);
  const comments = rows.slice(1, 1 + U.GCAL_CHEAT_SHEET.length);
  assert.ok(comments.every((r) => r[0] === '' && r[1] === '' && r[2] !== ''));
  assert.deepEqual(comments.map((r) => r[2]), plain(U.GCAL_CHEAT_SHEET));
  // One empty row separates the cheat sheet from the preset block.
  assert.deepEqual(rows.slice(1 + U.GCAL_CHEAT_SHEET.length), [
    ['', '', ''],
    ['preset-1', '', 'First Google Calendar preset'],
    ['', 'id', 'FILL IN WITH CALENDAR ID'],
    ['', 'title', '{rotation}: {who}'],
    ['', 'body', 'Rotalator shift {rotation} {start} to {end}. {note}'],
    ['', 'allday', 'auto'],
    ['', 'color', 'default'],
    ['', 'free', 'true'],
    ['', 'invite', 'true'],
    ['', 'reminders', ''],
  ]);
  const parsed = plain(U.parseGCalPresets(rows.slice(1)));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(plain(U.gcalRowsWithErrors(rows.slice(1), [])), rows.slice(1), 'no error rows to add');
  assert.equal(parsed.presets.length, 1);
  const first = 4 + U.GCAL_CHEAT_SHEET.length;
  assert.deepEqual(parsed.presets[0], { name: 'preset-1', note: 'First Google Calendar preset', row: 3 + U.GCAL_CHEAT_SHEET.length, setRows: { id: first, title: first + 1, body: first + 2, allday: first + 3, color: first + 4, free: first + 5, invite: first + 6, reminders: first + 7 }, errors: [], id: 'FILL IN WITH CALENDAR ID', title: '{rotation}: {who}', body: 'Rotalator shift {rotation} {start} to {end}. {note}', allday: 'auto', color: 'default', free: true, invite: true, reminders: [] });
  assert.equal(typeof U.gcal_setupTab, 'function');
  assert.equal(U.gcal_setupTab({ getName: () => 'primary' }), false, 'other tabs are left to the core');
  assert.deepEqual(plain(U.GCAL_COLUMN_WIDTHS), [140, 120, 700]);
  assert.equal(U.gcalSummary({ lines: [{ create: 1, update: 2, delete: 0, unchanged: 3, skipped: 1 }, { create: 1, update: 0, delete: 1, unchanged: 0, skipped: 1 }], errors: [{ where: 'x', message: 'boom' }] }), 'create 2, update 2, delete 1, unchanged 3, skipped 2; finished with 1 error(s) and 0 warning(s)');
  const sheet = (name, row, names) => ({ getName: () => name, getActiveRange: () => ({ getRow: () => row }), getRange: (r, c, n) => ({ getValues: () => names.slice(0, n).map((v) => [v]) }) });
  const names = ['preset', 'team', '', '', 'personal', ''];
  assert.equal(U.gcalSelectedPreset(sheet('#GCal', 4, names)), 'team');
  assert.equal(U.gcalSelectedPreset(sheet('#GCal', 5, names)), 'personal');
  assert.equal(U.gcalSelectedPreset(sheet('#GCal', 1, names)), null);
  assert.equal(U.gcalSelectedPreset(sheet('primary', 3, names)), null);
});

// A guard with an injected clock and abort flag, like the one withLock arms in Apps Script. The reconcile asks
// it once per calendar and once before each event, so abortAfter counts those checks.
function fakeGuard({ abortAfter = Infinity, stepSeconds = 0, budget = 300 } = {}) {
  let checks = 0, now = 0;
  return U.runGuard({ start: 0, budgetSeconds: budget, clock: () => now, aborted: () => { checks++; now += stepSeconds * 1000; return checks > abortAfter; } });
}

test('reconcile and clean stop between events on abort or budget, recording the note; progress per calendar', () => {
  const calendars = installMocks([TEAM_CAL, PERSONAL_CAL]);
  try {
    const result = runDir(FIXTURE, null, { export: false });
    const plan = U.gcalPlan(result, result.ext.gcal, {});
    // Abort at the fourth check (calendar, event, event, event): two events created, the rest left for the next run.
    const progressed = [];
    const aborted = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC', guard: fakeGuard({ abortAfter: 3 }), progress: (l) => progressed.push(l.preset) });
    assert.deepEqual(plain(aborted.lines).map((l) => [l.preset, l.create]), [['team', 2], ['personal', 0]]);
    assert.equal(aborted.stopped, 'aborted');
    assert.equal(aborted.note, 'aborted after 2 event(s)');
    assert.equal(aborted.elapsed, 0);
    assert.deepEqual(progressed, [], 'no calendar finished');
    assert.equal(calendars[TEAM_CAL].live().length, 2);
    assert.equal(calendars[PERSONAL_CAL].live().length, 0);
    // The next run, unguarded, completes the rest and reports progress per finished calendar.
    const rest = U.gcalReconcile(plan, U.gcalStatusData(plan), { tz: 'UTC', progress: (l) => progressed.push(l.preset) });
    assert.deepEqual(plain(rest.lines).map((l) => [l.create, l.unchanged]), [[1, 2], [3, 0]]);
    assert.equal(rest.note, undefined);
    assert.deepEqual(progressed, ['team', 'personal']);
    // Budget: the clock advances 100 s per check with a 300 s budget, so the third check stops the loop.
    const changed = structuredClone(plan);
    changed.events.forEach((e) => { e.title = 'x ' + e.title; });
    const budget = U.gcalReconcile(changed, U.gcalStatusData(changed), { tz: 'UTC', guard: fakeGuard({ stepSeconds: 100 }) });
    assert.deepEqual(plain(budget.lines).map((l) => [l.update, l.unchanged]), [[1, 0], [0, 0]]);
    assert.equal(budget.stopped, 'budget');
    assert.equal(budget.note, 'time budget reached after 1 event(s); the next run continues');
    assert.equal(budget.elapsed, 300);
    assert.equal(calendars[TEAM_CAL].live().filter((ev) => ev.title.startsWith('x ')).length, 1);
    // Dry runs check the guard too; nothing was written anyway.
    const dry = U.gcalReconcile(changed, U.gcalStatusData(changed), { tz: 'UTC', dry: true, guard: fakeGuard({ abortAfter: 0 }) });
    assert.equal(dry.note, 'aborted after 0 event(s)');
    // Clean stops the same way, counting deletions done.
    const clean = U.gcalCleanPlan(result, result.ext.gcal, { rotation: 'primary' });
    const partial = plain(U.gcalClean(clean, { tz: 'UTC', guard: fakeGuard({ abortAfter: 4 }) }));
    assert.deepEqual(partial, { deleted: 3, errors: [], stopped: 'aborted', note: 'aborted after 3 deletion(s)', elapsed: 0 });
    assert.equal(calendars[TEAM_CAL].live().length, 0);
    assert.equal(calendars[PERSONAL_CAL].live().length, 3);
    assert.equal(U.gcalSummary({ lines: [], errors: [], elapsed: 7, note: 'aborted after 3 event(s)' }), 'create 0, update 0, delete 0, unchanged 0, skipped 0 in 7 s; aborted after 3 event(s); finished with 0 error(s) and 1 warning(s)');
  assert.equal(U.gcalSummary({ lines: [], errors: [{ message: 'x' }], elapsed: 1 }), 'create 0, update 0, delete 0, unchanged 0, skipped 0 in 1 s; finished with 1 error(s) and 0 warning(s)');
  } finally { removeMocks(); }
});

test('error rows: placed above the offending row, dropped on read, written back once, gone when fixed', () => {
  const rows = [
    G('', 'id', 'early@example.com'),
    G('team', '', 'ok'),
    G('', 'id', 'team@example.com'),
    G('', 'colour', 'red'),
    G('', 'title', '{what}'),
    G('noid', '', ''),
    G('', 'free', 'true'),
  ];
  const parsed = U.parseGCalPresets(rows);
  const two = U.parseGCalPresets([G('t', '', ''), G('', 'id', 'x'), ['', 'title', '{a} {start:%q}']]);
  assert.deepEqual(plain(parsed.errors).map((e) => e.row), [2, 5, 6, 7]);
  // where names the offending row as it sits once the error rows are written above it.
  assert.deepEqual(plain(parsed.errors).map((e) => e.where), ['#GCal row 3', '#GCal row 7', '#GCal row 9', '#GCal row 11']);
  assert.deepEqual(plain(two.errors).map((e) => e.where), ['#GCal row 6', '#GCal row 6'], 'two errors on one row: both name the row below both error rows');
  const withErrors = plain(U.gcalRowsWithErrors(rows, parsed.errors));
  assert.deepEqual(withErrors, [
    ['', 'error', 'setting "id" before any preset'],
    ['', 'id', 'early@example.com'],
    ['team', '', 'ok'],
    ['', 'id', 'team@example.com'],
    ['', 'error', 'unknown setting "colour"'],
    ['', 'colour', 'red'],
    ['', 'error', 'unknown placeholder {what} in title'],
    ['', 'title', '{what}'],
    ['', 'error', 'preset "noid" has no id'],
    ['noid', '', ''],
    ['', 'free', 'true'],
  ]);
  // Several errors on one row keep their order; short rows are padded.
  assert.deepEqual(plain(U.gcalRowsWithErrors([['t'], ['', 'id', 'x'], ['', 'title', '{a} {start:%q}']], two.errors)), [
    ['t', '', ''], ['', 'id', 'x'],
    ['', 'error', 'unknown placeholder {a} in title'], ['', 'error', 'unknown directive %q in title'],
    ['', 'title', '{a} {start:%q}'],
  ]);
  // Error rows are the script's: dropped on read, never parsed.
  assert.deepEqual(plain(U.gcalDropErrorRows(withErrors)), rows);
  assert.equal(U.gcalIsErrorRow(['', 'Error', 'x']), true);
  assert.equal(U.gcalIsErrorRow(['p', 'error', 'x']), false, 'a preset named error is not an error row');
  assert.deepEqual(plain(U.parseGCalPresets(U.gcalDropErrorRows(withErrors)).errors), plain(parsed.errors));
  // Through the storage: readInputs writes the tab back with the error rows; a second read is identical.
  const storage = new MemoryStorage({ tabs: { '#GCal': rows } });
  const inputs = plain(U.gcal_readInputs(storage));
  assert.equal(inputs.errors.length, 4);
  assert.deepEqual(storage.tabs['#GCal'], withErrors);
  const again = plain(U.gcal_readInputs(storage));
  assert.deepEqual(again, inputs);
  assert.deepEqual(storage.tabs['#GCal'], withErrors, 'second run identical');
  // Fixed rows: the error rows disappear on the next run; a clean tab is not rewritten.
  const fixed = withErrors.filter((r) => r[1] !== 'error' && r[1] !== 'colour' && r[0] !== 'noid' && r[1] !== 'free' && r[2] !== 'early@example.com').map((r) => (r[1] === 'title' ? ['', 'title', '{who}'] : r));
  storage.tabs['#GCal'] = [['', 'error', 'stale'], ...fixed];
  assert.deepEqual(plain(U.gcal_readInputs(storage)).errors, []);
  assert.deepEqual(storage.tabs['#GCal'], fixed);
  storage.writeTabRows = () => { throw new Error('must not write'); };
  assert.deepEqual(plain(U.gcal_readInputs(storage)).errors, []);
  // A storage without writeTabRows only reads.
  assert.equal(plain(U.gcal_readInputs({ readTabRows: () => rows })).errors.length, 4);
  // CSV: read-only storage writes nothing; a writable one rewrites gcal.csv with the error rows.
  const dir = path.join(__dirname, '..', '.tmp', 'gcal-errors');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gcal.csv'), U.formatCsv([['preset', 'setting', 'value'], ...rows]));
  U.gcal_readInputs(new CsvDirStorage(dir, { readOnly: true }));
  assert.equal(fs.readFileSync(path.join(dir, 'gcal.csv'), 'utf8'), U.formatCsv([['preset', 'setting', 'value'], ...rows]));
  U.gcal_readInputs(new CsvDirStorage(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'gcal.csv'), 'utf8'), U.formatCsv([['preset', 'setting', 'value'], ...withErrors]));
  assert.deepEqual(plain(new CsvDirStorage(dir).readTabRows(U.GCAL_TAB, U.GCAL_HEADER)), withErrors);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('in-place errors: unknown preset above the cal set row in the rotation or in #Global, idempotent', () => {
  const ERR = (start, message) => ['', start, 'error', message, '', '', ''];
  const presets = [G('team', '', ''), G('', 'id', 'team@example.com')];
  // In the rotation: the error row lands directly above the set row that names the preset, same start.
  const mem = new MemoryStorage({ ledgers: ledger(BASE + ', cal=team nope'), tabs: { '#GCal': presets } });
  const result = runStorage(mem, NOW, { write: true });
  assert.deepEqual(result.errors, ['GCal primary: unknown preset "nope" in cal; add it to #GCal']);
  const rows = mem.ledgers.primary;
  assert.deepEqual(rows[0], ERR('2026-10-05T09:00', 'unknown preset "nope" in cal; add it to #GCal'));
  assert.equal(rows[1][2], 'set');
  assert.deepEqual(result.ledgers.primary, rows, 'the result carries the written rows');
  // Second run: the core drops the error row on read and the extension writes it again; identical output.
  const again = runStorage(new MemoryStorage({ ledgers: mem.ledgers, tabs: { '#GCal': presets } }), NOW, { write: true });
  assert.deepEqual(again.ledgers.primary, rows);
  // Fixed: no error row.
  const fixed = runStorage(new MemoryStorage({ ledgers: mem.ledgers.primary ? { primary: mem.ledgers.primary.map((r) => (r[2] === 'set' ? [r[0], r[1], r[2], r[3].replace(' nope', ''), r[4], r[5], r[6]] : r)) } : {}, tabs: { '#GCal': presets } }), NOW, { write: true });
  assert.deepEqual(fixed.errors, []);
  assert.ok(!fixed.ledgers.primary.some((r) => r[2] === 'error'));
  // Without write nothing is written and the result's ledgers stay as the core produced them.
  const dry = new MemoryStorage({ ledgers: ledger(BASE + ', cal=team nope'), tabs: { '#GCal': presets } });
  const dryRun = runStorage(dry, NOW);
  assert.ok(!dryRun.ledgers.primary.some((r) => r[2] === 'error'));
  assert.equal(dry.ledgers.primary.length, 2);
  // From #Global: the error goes above the global set row, prefixed with the rotation; two rotations, two rows.
  const global = [R('', '', 'set', 'cal=team nope'), R('', '2026-10-05T09:00', 'set', 'horizon=2w')];
  const two = { primary: ledger(BASE).primary, secondary: ledger(BASE).primary };
  const gmem = new MemoryStorage({ ledgers: two, global, tabs: { '#GCal': presets } });
  const gres = runStorage(gmem, NOW, { write: true });
  assert.deepEqual(gres.errors, ['GCal primary: unknown preset "nope" in cal; add it to #GCal', 'GCal secondary: unknown preset "nope" in cal; add it to #GCal']);
  assert.deepEqual(gmem.global.slice(0, 3), [
    ERR('', 'primary: unknown preset "nope" in cal; add it to #GCal'),
    ERR('', 'secondary: unknown preset "nope" in cal; add it to #GCal'),
    R('', '', 'set', 'cal=team nope'),
  ]);
  assert.ok(!gmem.ledgers.primary.some((r) => r[2] === 'error'), 'nothing in the rotation tabs');
  const gagain = runStorage(new MemoryStorage({ ledgers: gmem.ledgers, global: gmem.global, tabs: { '#GCal': presets } }), NOW, { write: true });
  assert.deepEqual(gagain.global, gmem.global);
  // A later set row that puts cal in force after now is not the carrier; the one in force at now is.
  const later = ledger(BASE + ', cal=team');
  later.primary.push(R('', '2026-10-12T09:00', 'set', 'cal=nope'));
  const lmem = new MemoryStorage({ ledgers: later, tabs: { '#GCal': presets } });
  runStorage(lmem, NOW, { write: true });
  assert.ok(!lmem.ledgers.primary.some((r) => r[2] === 'error'), 'cal=team is in force at now, so nothing is wrong yet');
  // Shared calendar between two presets: above the cal row too.
  const shared = [G('a', '', ''), G('', 'id', 'same@example.com'), G('b', '', ''), G('', 'id', 'same@example.com')];
  const smem = new MemoryStorage({ ledgers: ledger(BASE + ', cal=a b'), tabs: { '#GCal': shared } });
  runStorage(smem, NOW, { write: true });
  assert.deepEqual(smem.ledgers.primary[0], ERR('2026-10-05T09:00', 'preset "b" skipped: calendar same@example.com is already used by preset "a"'));
  assert.equal(U.gcalCellsWithCalErrors([R('', '2026-10-05T09:00', 'set', 'period=1w')], U.parseDateTime(NOW), ['x']), null, 'no cal row, nothing to place');
});

test('in-place errors: a calendar that cannot be opened is reported above the preset id row in #GCal', () => {
  const calendars = installMocks([TEAM_CAL]);
  try {
    const storage = new CsvDirStorage(FIXTURE);
    const presets = storage.readTabRows(U.GCAL_TAB, U.GCAL_HEADER);
    const inputs = { ledgers: storage.readLedgers(), holidays: storage.readHolidays(), global: storage.readGlobal(), tabs: { '#GCal': presets } };
    const mem = new MemoryStorage(inputs);
    const result = runStorage(mem, storage.readNow(), { write: true });
    assert.deepEqual(result.errors, ['GCal primary / personal: calendar "oncall@example.com" not found or not shared with this account']);
    const tab = mem.tabs['#GCal'];
    const idRow = tab.findIndex((r) => r[1] === 'id' && r[2] === 'oncall@example.com');
    assert.deepEqual(tab[idRow - 1], ['', 'error', 'calendar "oncall@example.com" not found or not shared with this account (primary / personal)']);
    assert.equal(tab.length, presets.length + 1);
    assert.deepEqual(result.status.ext.gcal.errors.map((e) => e.where), ['primary / personal']);
    // Second run: dropped on read, written again; identical.
    const again = new MemoryStorage({ ...inputs, ledgers: mem.ledgers, tabs: { '#GCal': tab } });
    runStorage(again, storage.readNow(), { write: true });
    assert.deepEqual(again.tabs['#GCal'], tab);
    // Once the calendar exists the row is gone.
    calendars[PERSONAL_CAL] = new MockCalendar(PERSONAL_CAL);
    const fixed = new MemoryStorage({ ...inputs, ledgers: mem.ledgers, tabs: { '#GCal': tab } });
    const ok = runStorage(fixed, storage.readNow(), { write: true });
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(fixed.tabs['#GCal'], plain(presets));
    // A stop note becomes a warning of the run too.
    const stopped = runStorage(new MemoryStorage({ ...inputs, tabs: { '#GCal': presets } }), storage.readNow(), { write: true });
    assert.deepEqual(stopped.status.warnings, []);
  } finally { removeMocks(); }
});

test('status metadata: errors and warnings rows are marked for the adapter', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers: ledger(BASE.replace('min_distance=0', 'min_distance=2sl').replace('horizon=2w', 'horizon=3w')) }), NOW);
  const out = plain(U.statusRows(status));
  const rows = out.rows;
  const w = rows.findIndex((r) => r[0] === 'warnings');
  assert.ok(w > 0 && status.warnings.length > 0);
  assert.deepEqual(out.warningRows, status.warnings.map((_, i) => w + 2 + i));
  assert.deepEqual(out.errorRows, []);
  const broken = ledger(BASE);
  broken.primary.push(R('', '2026-10-12T09:00', 'holiday', ''));
  const failed = plain(U.statusRows(runStorage(new MemoryStorage({ ledgers: broken }), NOW).status));
  const e = failed.rows.findIndex((r) => r[0] === 'errors');
  assert.deepEqual(failed.errorRows, [e + 2]);
  assert.deepEqual(failed.warningRows, []);
  assert.equal(U.finishedText(0, 0), 'finished, no errors');
  assert.equal(U.finishedText(2, 1), 'finished with 2 error(s) and 1 warning(s)');
  assert.equal(U.finishedText(0, 3), 'finished with 0 error(s) and 3 warning(s)');
});
