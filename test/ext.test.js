'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../node/load.js');
const { runStorage, statusText } = require('../node/cli.js');
const { MemoryStorage } = require('../node/storage.js');

const U = load();
const plain = (v) => structuredClone(v);
const trim = (rows) => structuredClone(rows).map((r) => { while (r.length && r[r.length - 1] === '') r.pop(); return r; });
const R = (pin, start, type, what, end = '', duration = '', note = '') => [pin, start, type, what, end, duration, note];
const NOW = '2026-10-05T10:00';
const ledger = (set) => ({ primary: [
  R('', '2026-10-05T09:00', 'set', set),
  R('', '2026-10-05T09:00', 'team', 'alice, bob'),
] });
const BASE = 'period=1w, horizon=2w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0';

// Defines fake gcal_<hook> functions in the shared context for one test and removes them afterwards.
function withFakeGcal(hooks, fn) {
  const names = Object.keys(hooks);
  names.forEach((hook) => { U[`gcal_${hook}`] = hooks[hook]; });
  try { return fn(); } finally { names.forEach((hook) => { delete U[`gcal_${hook}`]; }); }
}

const names = (hook) => plain(U.extensionHooks(hook).map((h) => h.name));

test('extension hooks: none present without an extension bundle', () => {
  assert.deepEqual(plain(U.EXTENSIONS), ['GCal']);
  assert.deepEqual(plain(U.EXTENSION_HOOKS), ['menu', 'setup', 'help', 'readInputs', 'afterRun', 'status']);
  assert.equal(U.extensionHookName('GCal', 'menu'), 'gcal_menu');
  assert.equal(U.extensionHook('GCal', 'menu'), null);
  assert.deepEqual(plain(U.extensionHooks('status')), []);
  assert.equal(U.extensionInstalled('GCal'), false);
});

test('extension hooks: probed by typeof at call time, only for listed extensions', () => {
  // A function added to the shared scope after the core loaded is found without any registration.
  U.gcal_menu = (menu) => { menu.items.push('gcal'); };
  try {
    assert.equal(typeof U.extensionHook('GCal', 'menu'), 'function');
    assert.deepEqual(names('menu'), ['GCal']);
    assert.equal(U.extensionInstalled('GCal'), true);
    const found = U.extensionHooks('menu');
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'GCal');
    assert.equal(found[0].prefix, 'gcal');
    const menu = { items: [] };
    found[0].fn(menu);
    assert.deepEqual(menu.items, ['gcal']);
    assert.deepEqual(plain(U.extensionHooks('setup')), [], 'missing hooks are skipped');
  } finally {
    delete U.gcal_menu;
  }
  assert.deepEqual(names('menu'), []);
  // A hook of an extension not in the list, or a non-function of the right name, is not a hook.
  U.other_menu = () => {};
  U.gcal_setup = 'not a function';
  try {
    assert.deepEqual(names('menu').concat(names('setup')), []);
    assert.equal(U.extensionInstalled('GCal'), false);
  } finally {
    delete U.other_menu;
    delete U.gcal_setup;
  }
});

test('callExtensionHooks: values of the hooks that returned, failures to onError, default a console line', () => {
  const failures = [];
  const onError = (h, e) => failures.push([h.name, e.message]);
  assert.deepEqual(plain(U.callExtensionHooks('menu', [1], onError)), []);
  withFakeGcal({ menu: (a, b) => a + b }, () => {
    assert.deepEqual(plain(U.callExtensionHooks('menu', [1, 2], onError)), [{ name: 'GCal', prefix: 'gcal', value: 3 }]);
  });
  withFakeGcal({ menu: () => { throw new Error('boom'); } }, () => {
    assert.deepEqual(plain(U.callExtensionHooks('menu', [], onError)), []);
    assert.deepEqual(failures, [['GCal', 'boom']]);
    // Without onError the failure is logged, never thrown.
    const logged = [];
    const original = U.console.log;
    U.console.log = (line) => logged.push(line);
    try { assert.deepEqual(plain(U.callExtensionHooks('menu', [])), []); } finally { U.console.log = original; }
    assert.deepEqual(logged, ['GCal extension: boom']);
  });
  withFakeGcal({ menu: () => { throw 'plain'; } }, () => {
    U.callExtensionHooks('menu', [], onError);
    assert.deepEqual(failures[1], ['GCal', undefined]);
    assert.equal(U.extensionErrorMessage({ name: 'GCal' }, 'plain'), 'GCal extension: plain');
  });
  assert.deepEqual(plain(U.extensionError({ name: 'GCal' }, new Error('x'))), { rotation: 'GCal', rowIndex: null, start: null, message: 'GCal extension: x' });
});

test('runner: a throwing hook never fails the run and is reported as an error', () => {
  const boom = () => { throw new Error('boom'); };
  const seen = [];
  // readInputs fails: the ledgers are still run and written, afterRun is skipped, the error is in the run,
  // the status and the written status.
  const storage = new MemoryStorage({ ledgers: ledger(BASE) });
  const result = withFakeGcal({ readInputs: boom, afterRun: () => seen.push('afterRun') }, () => runStorage(storage, NOW, { write: true }));
  assert.deepEqual(result.errors, ['GCal extension: boom']);
  assert.deepEqual(result.ext, {});
  assert.equal(result.ledgers.primary.filter((r) => r[2] === 'shift').length, 2);
  assert.deepEqual(seen, []);
  assert.deepEqual(result.status.errors, [{ rotation: 'GCal', rowIndex: null, start: null, message: 'GCal extension: boom' }]);
  assert.deepEqual(plain(storage.status.errors), result.status.errors);
  assert.deepEqual(storage.ledgers.primary, result.ledgers.primary, 'ledgers written');
  assert.match(statusText(result.status), /\nerrors\nrotation +where +message\nGCal +GCal extension: boom\n/);
  // afterRun fails after the ledgers are written: the status is still written, with the error.
  const late = new MemoryStorage({ ledgers: ledger(BASE) });
  const failed = withFakeGcal({ afterRun: boom }, () => runStorage(late, NOW, { write: true }));
  assert.deepEqual(failed.errors, ['GCal extension: boom']);
  assert.ok(late.status !== null && late.ledgers.primary.length > 2);
  assert.deepEqual(plain(late.status.errors).map((e) => e.message), ['GCal extension: boom']);
  // A bad now with a failing readInputs reports both.
  const both = withFakeGcal({ readInputs: boom }, () => runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), 'someday'));
  assert.deepEqual(both.errors, ['bad now "someday"', 'GCal extension: boom']);
});

test('status: a throwing status hook adds an error row; wide rows are cut to 17 columns', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), NOW);
  const rows = withFakeGcal({ status: () => { throw new Error('bad block'); } }, () => trim(U.statusRows(status).rows));
  assert.deepEqual(rows.slice(-3), [['errors'], ['rotation', 'where', 'message'], ['GCal', '', 'GCal extension: bad block']]);
  assert.deepEqual(status.errors, [], 'the status data itself is not changed');
  const wide = withFakeGcal({ status: () => ({ rows: [new Array(20).fill('w'), ['x']] }) }, () => plain(U.statusRows(status).rows));
  assert.ok(wide.every((r) => r.length === 17));
  assert.deepEqual(wide[wide.length - 2], new Array(17).fill('w'));
  const notRows = withFakeGcal({ status: () => ({ rows: 'nope' }) }, () => U.statusRows(status).rows.length);
  assert.equal(notRows, U.statusRows(status).rows.length);
});

test('help: extension lines follow HELP_TEXT; a failing or odd hook adds nothing', () => {
  assert.deepEqual(plain(U.helpText()), plain(U.HELP_TEXT));
  const extra = ['', 'CALENDAR:', 'cal=team: export'];
  const lines = withFakeGcal({ help: (given) => { assert.deepEqual(plain(given), plain(U.HELP_TEXT)); return extra; } }, () => plain(U.helpText()));
  assert.deepEqual(lines, [...plain(U.HELP_TEXT), ...extra]);
  assert.deepEqual(plain(U.helpHeadingRows(lines)).slice(-1), [lines.length - 2]);
  assert.deepEqual(plain(U.helpHeadingRows()), plain(U.helpHeadingRows(U.HELP_TEXT)));
  const logged = [];
  const original = U.console.log;
  U.console.log = (line) => logged.push(line);
  try {
    assert.deepEqual(withFakeGcal({ help: () => { throw new Error('no help'); } }, () => plain(U.helpText())), plain(U.HELP_TEXT));
  } finally { U.console.log = original; }
  assert.deepEqual(logged, ['GCal extension: no help']);
  assert.deepEqual(withFakeGcal({ help: () => 'text' }, () => plain(U.helpText())), plain(U.HELP_TEXT));
});

test('runner: readInputs before regenerate, afterRun after the ledgers and before the status, not on errors', () => {
  const calls = [];
  const storage = new MemoryStorage({ ledgers: ledger(BASE) });
  const original = storage.writeStatus.bind(storage);
  storage.writeStatus = (data) => { calls.push('writeStatus'); original(data); };
  storage.writeLedger = ((inner) => (name, rows) => { calls.push('writeLedger'); inner(name, rows); })(storage.writeLedger.bind(storage));
  const hooks = {
    readInputs: (s) => { calls.push('readInputs'); assert.equal(s, storage); return { presets: ['team'] }; },
    afterRun: (result, s, options) => {
      calls.push('afterRun');
      assert.equal(s, storage);
      assert.equal(options.mode, 'dry run');
      assert.deepEqual(plain(result.ext), { gcal: { presets: ['team'] } });
      assert.equal(Object.keys(result.ledgers).length, 1);
      result.status.ext = { gcal: { exported: 2 } };
    },
  };
  const result = withFakeGcal(hooks, () => runStorage(storage, NOW, { write: true, mode: 'dry run' }));
  assert.deepEqual(calls, ['readInputs', 'writeLedger', 'afterRun', 'writeStatus']);
  assert.deepEqual(result.ext, { gcal: { presets: ['team'] } });
  assert.deepEqual(result.status.ext, { gcal: { exported: 2 } });
  assert.deepEqual(plain(storage.status.ext), { gcal: { exported: 2 } }, 'the written status carries what afterRun recorded');

  // Without write the hooks still run; the extension sees options.write.
  const dry = [];
  withFakeGcal({ afterRun: (r, s, options) => dry.push(Boolean(options.write)) }, () => runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), NOW));
  assert.deepEqual(dry, [false]);

  // A validation error or a bad now skips afterRun; readInputs has already run.
  const broken = ledger(BASE);
  broken.primary.push(R('', '2026-10-12T09:00', 'holiday', ''));
  const seen = [];
  const failed = withFakeGcal({ readInputs: () => { seen.push('readInputs'); return 1; }, afterRun: () => seen.push('afterRun') },
    () => runStorage(new MemoryStorage({ ledgers: broken }), NOW, { write: true }));
  assert.equal(failed.errors.length, 1);
  assert.deepEqual(seen, ['readInputs']);
  assert.deepEqual(failed.ext, { gcal: 1 });
  const badNow = withFakeGcal({ afterRun: () => seen.push('afterRun') }, () => runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), 'someday'));
  assert.deepEqual(badNow.errors, ['bad now "someday"']);
  assert.deepEqual(seen, ['readInputs']);
  assert.deepEqual(badNow.ext, {});

  // Without the extension the result has an empty ext.
  assert.deepEqual(runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), NOW).ext, {});
});

test('status: extension rows follow the frame after a blank row, headers marked', () => {
  const { status } = runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), NOW);
  const without = U.statusRows(status);
  const block = (data) => ({ rows: [['Calendar'], ['rotation', 'preset', 'events'], ['primary', 'team', String(data.rotations.length)]], headerRows: [0, 1] });
  const withRows = withFakeGcal({ status: block }, () => plain(U.statusRows(status)));
  const rows = withRows.rows;
  assert.equal(rows.length, without.rows.length + 4);
  assert.ok(rows.every((r) => r.length === 17));
  assert.deepEqual(rows[without.rows.length].slice(0, 3), ['', '', '']);
  assert.deepEqual(rows[without.rows.length + 1].slice(0, 1), ['Calendar']);
  assert.deepEqual(rows[without.rows.length + 2].slice(0, 3), ['rotation', 'preset', 'events']);
  assert.deepEqual(rows[without.rows.length + 3].slice(0, 3), ['primary', 'team', '1']);
  assert.deepEqual(withRows.headerRows.slice(-2), [without.rows.length + 1, without.rows.length + 2]);
  // Vertical (CLI) layout gets the same block; an empty or missing table adds nothing.
  assert.match(withFakeGcal({ status: block }, () => statusText(status)), /\nCalendar\nrotation +preset +events\nprimary +team +1\n/);
  assert.equal(withFakeGcal({ status: () => ({ rows: [] }) }, () => U.statusRows(status).rows.length), without.rows.length);
  assert.equal(withFakeGcal({ status: () => null }, () => U.statusRows(status).rows.length), without.rows.length);
  // Without headerRows the first row is the header.
  const first = withFakeGcal({ status: () => ({ rows: [['x'], ['y']] }) }, () => plain(U.statusRows(status)));
  assert.deepEqual(first.headerRows.slice(-1), [without.rows.length + 1]);
});

test('cal setting: space-separated preset names, empty default, bare key resets', () => {
  assert.equal(U.SETTINGS.cal.def, '');
  assert.equal(U.defaultSettings().cal, '');
  assert.equal(U.parseSetArg('cal=team', null).values.cal, 'team');
  assert.equal(U.parseSetArg('cal=team  backup-2_x', null).values.cal, 'team backup-2_x', 'single spaces, case kept');
  assert.equal(U.parseSetArg('period=1w, cal=Team', null).values.cal, 'Team');
  const bare = U.parseSetArg('cal', null);
  assert.equal(bare.values.cal, '');
  assert.deepEqual(plain(bare.reset), ['cal']);
  assert.match(U.parseSetArg('cal=team!', null).error, /bad value for cal: "team!"; use space-separated preset names of letters, digits, - and _/);
  assert.match(U.parseSetArg('cal=a.b', null).error, /bad value for cal/);
  assert.match(U.parseSetArg('cal=', null).error, /bad assignment/);
  assert.match(U.parseSetArg('cal=team, backup', null).error, /unknown setting "backup"/);
  // In a ledger: valid rows validate, a bad one is a row error.
  const rows = (what) => U.rowsFromCells([R('', '2026-10-05T09:00', 'set', what), R('', '2026-10-05T09:00', 'team', 'alice')]);
  assert.deepEqual(plain(U.validateLedger(rows('period=1w, cal=team backup'), 'r').errors), []);
  assert.equal(U.validateLedger(rows('period=1w, cal=te am/x'), 'r').errors.length, 1);
  // Template rows do not spell cal (nothing to spell at an empty default); the help text names it.
  assert.ok(!U.templateSetWhat().split(', ').some((item) => item.split('=')[0] === 'cal'));
  assert.ok(plain(U.HELP_TEXT).some((line) => line.startsWith('cal:')));
});

test('#GCal is a known system tab', () => {
  assert.equal(U.GCAL_TAB, '#GCal');
  assert.equal(U.isKnownSystemTab('#GCal'), true);
  assert.equal(U.isSystemTab('#GCal'), true);
  const storage = new MemoryStorage({ ledgers: ledger(BASE) });
  assert.deepEqual(runStorage(storage, NOW).status.tabs.ignored, []);
});

test('warning: calendar extension not installed when cal is in force', () => {
  const warned = runStorage(new MemoryStorage({ ledgers: ledger(BASE + ', cal=team backup') }), NOW);
  assert.deepEqual(warned.errors, []);
  assert.deepEqual(warned.status.warnings, [{ rotation: 'primary', start: null, message: 'calendar extension not installed; cal=team backup has no effect' }]);
  assert.match(statusText(warned.status), /warnings\nrotation +start +message\nprimary +calendar extension not installed; cal=team backup has no effect\n/);
  assert.equal(U.statusRows(warned.status).rows.some((r) => r[0] === 'warnings'), true);
  // The setting appears in the settings table with its source.
  const cal = warned.status.rotations[0].settings.values.find((v) => v.key === 'cal');
  assert.deepEqual(cal, { key: 'cal', value: 'team backup', source: 'rotation' });
  // From #Global too; a bare cal in the rotation hands the key back to the global value, so it still warns.
  const global = [R('', '2026-10-05T09:00', 'set', 'cal=shared')];
  const viaGlobal = runStorage(new MemoryStorage({ ledgers: ledger(BASE), global }), NOW);
  assert.equal(viaGlobal.status.warnings.length, 1);
  assert.equal(viaGlobal.status.rotations[0].settings.values.find((v) => v.key === 'cal').source, 'global');
  const reset = runStorage(new MemoryStorage({ ledgers: ledger(BASE + ', cal'), global }), NOW);
  assert.match(reset.status.warnings[0].message, /cal=shared/);
  assert.equal(reset.status.rotations[0].settings.values.find((v) => v.key === 'cal').source, 'global');
  // Not in force yet at now (a later set row) means no warning; empty cal never warns.
  const later = ledger(BASE);
  later.primary.push(R('', '2026-10-12T09:00', 'set', 'cal=team'));
  assert.deepEqual(runStorage(new MemoryStorage({ ledgers: later }), NOW).status.warnings, []);
  assert.deepEqual(runStorage(new MemoryStorage({ ledgers: ledger(BASE) }), NOW).status.warnings, []);
  // With any gcal hook present the extension counts as installed and the warning disappears.
  const quiet = withFakeGcal({ afterRun: () => {} }, () => runStorage(new MemoryStorage({ ledgers: ledger(BASE + ', cal=team') }), NOW));
  assert.deepEqual(quiet.status.warnings, []);
  // A validation error leaves the status without rotations and without the warning.
  const broken = ledger(BASE + ', cal=team');
  broken.primary.push(R('', '2026-10-12T09:00', 'holiday', ''));
  assert.deepEqual(runStorage(new MemoryStorage({ ledgers: broken }), NOW).status.warnings, []);
});

test('load: extensions are added to the shared context; unknown names throw', () => {
  assert.equal(load([]), U);
  assert.throws(() => load(['Nope']), /unknown extension "Nope": no src\/ext\/Nope\//);
  assert.equal(load(), U);
});
