'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../node/load.js');
const U = load(['Slack']);
const { runDir, runStorage, statusText, slackDir, slackPlanText, main } = require('../node/cli.js');
const { CsvDirStorage, MemoryStorage } = require('../node/storage.js');

const plain = (v) => structuredClone(v);
const dt = (s) => U.parseDateTime(s);
const FIXTURE = path.join(__dirname, 'fixtures', 'slack');
const R = (pin, start, type, what, end = '', duration = '', note = '') => [pin, start, type, what, end, duration, note];
const G = (preset, setting, value) => [preset, setting, value];
const NOW = '2026-10-05T10:00';
const BASE = 'period=1w, horizon=2w, tolerance=0, min_distance=0, skip_weekends=false, skip_holidays=false, autopin=a:0';
const ledger = (set, team = 'alice, bob') => ({ primary: [R('', '2026-10-05T09:00', 'set', set), R('', '2026-10-05T09:00', 'team', team)] });
const TEAM = [G('team', '', 'note'), G('', 'to', '#chan'), G('', 'group', '@oncall')];
const HEADS = [G('heads', '', ''), G('', 'to', '{who}, {prev}'), G('', 'when', '-3d'), G('', 'text', 'Soon: {who} after {prev}, then {next} ({group})')];
const STATE = (rows) => U.slackStateFromRows(rows);

// A run in memory with the given #Slack rows and state rows; returns { result, plan, storage }.
function planFor(set, tabs, state = [], options = {}) {
  const storage = new MemoryStorage({ ledgers: options.ledgers || ledger(set), global: options.global || [], tabs: { '#Slack': tabs, '#Slack state': state } });
  const result = runStorage(storage, options.now || NOW, options.run || {});
  return { result, storage, plan: result.status ? plain(U.slackPlan(result, result.ext.slack, STATE(state))) : null };
}

test('loader and storage: hooks visible, slack.csv is #Slack, slack-state.csv is #Slack state', () => {
  assert.equal(typeof U.slack_readInputs, 'function');
  assert.equal(U.extensionInstalled('Slack'), true);
  assert.deepEqual(plain(U.extensionHooks('afterRun').map((h) => h.prefix)), ['slack']);
  const storage = new CsvDirStorage(FIXTURE);
  assert.equal(storage.readTabRows(U.SLACK_TAB, U.PRESET_HEADER).length, 12);
  assert.equal(storage.readTabRows(U.SLACK_STATE_TAB, U.SLACK_STATE_HEADER).length, 4);
  assert.deepEqual(Object.keys(storage.readLedgers()), ['primary', 'secondary']);
  assert.deepEqual(storage.ignoredTabs(), []);
});

test('presets: the fixture parses into three presets and the id map', () => {
  const inputs = plain(U.parseSlackPresets(new CsvDirStorage(FIXTURE).readTabRows(U.SLACK_TAB, U.PRESET_HEADER)));
  assert.deepEqual(inputs.errors, []);
  assert.deepEqual(inputs.ids, { alice: 'U0ALICE' });
  assert.deepEqual(inputs.presets.map((p) => p.name), ['team', 'heads-up', 'second']);
  assert.deepEqual(inputs.presets[0], {
    name: 'team', note: 'Channel handover message and the @oncall group', row: 2, setRows: { to: 3, text: 4, group: 5 }, errors: [],
    to: ['#oncall-team'], when: 0, text: '{who} is on call for {rotation} from {start} to {end}', group: '@oncall',
  });
  assert.deepEqual(inputs.presets[1], {
    name: 'heads-up', note: 'Reminder to the person three days before', row: 6, setRows: { to: 7, when: 8, text: 9 }, errors: [],
    to: ['{who}'], when: -3 * 1440, text: 'Reminder: you are on call for {rotation} from {start:%a %e %b} to {end:%a %e %b}', group: null,
  });
  assert.deepEqual(inputs.presets[2].to, ['C0SECOND']);
  assert.equal(U.SLACK_DEFAULT_TEXT, '{who} is on call for {rotation} from {start} to {end}');
  assert.equal(U.slackPreset(inputs, 'second').group, '@oncall');
  assert.equal(U.slackPreset(inputs, 'nope'), null);
  assert.deepEqual(plain(U.parseSlackPresets([])), { presets: [], errors: [], ids: {} });
});

test('presets: every error; a preset needs to or group; id rows are never presets', () => {
  const rows = [
    G('', 'to', '#early'),
    G('bad name', '', ''),
    G('', 'to', '#x'),
    G('team', '', ''),
    G('', 'to', 'nope, #ok'),
    G('', 'to', '#again'),
    G('', 'when', '1w'),
    G('', 'text', ''),
    G('', 'group', 'oncall'),
    G('', 'colour', 'red'),
    G('heads', '', ''),
    G('', 'to', '{rotation}, {who}, {nope}'),
    G('', 'text', '{what} {start:%Q}'),
    G('', 'when', 'soon'),
    G('empty', '', ''),
    G('team', '', 'second'),
    G('', 'group', 'S0GRP'),
    G('alice', 'id', 'U1'),
    G('bob@example.com', 'ID', 'U2'),
    G('ok', '', ''),
    G('', 'to', 'C1, G2, U3, W4, #chan-1, a.b@c.d, {WHO}, {Prev}, {next}'),
    G('', 'when', '1d12h'),
    G('', 'group', '@on-call.2'),
  ];
  const out = plain(U.parseSlackPresets(rows));
  assert.deepEqual(out.ids, { alice: 'U1', 'bob@example.com': 'U2' });
  assert.deepEqual(out.errors.map((e) => [e.row, e.message]), [
    [2, 'setting "to" before any preset'],
    [3, 'bad preset name "bad name"; use letters, digits, - and _ without spaces'],
    [6, 'bad value for to: "nope, #ok"; use ' + U.SLACK_TO_HINT],
    [7, 'duplicate setting "to"'],
    [8, 'bad value for when: "1w"; use ' + U.SLACK_WHEN_HINT],
    [9, 'bad value for text: ""'],
    [10, 'bad value for group: "oncall"; use ' + U.SLACK_GROUP_HINT],
    [11, 'unknown setting "colour"'],
    [13, 'unknown placeholder {rotation} in to'],
    [13, 'unknown placeholder {nope} in to'],
    [14, 'unknown placeholder {what} in text'],
    [14, 'unknown directive %Q in text'],
    [15, 'bad value for when: "soon"; use ' + U.SLACK_WHEN_HINT],
    [16, 'preset "empty" needs to or group'],
    [17, 'duplicate preset "team"'],
  ]);
  assert.match(out.errors[0].where, /^#Slack row \d+$/);
  assert.deepEqual(out.presets.map((p) => [p.name, p.errors.length]), [['bad name', 1], ['team', 6], ['heads', 5], ['empty', 1], ['team', 1], ['ok', 0]]);
  const ok = out.presets[5];
  assert.deepEqual(ok.to, ['C1', 'G2', 'U3', 'W4', '#chan-1', 'a.b@c.d', '{WHO}', '{Prev}', '{next}']);
  assert.equal(ok.when, 36 * 60);
  assert.equal(ok.group, '@on-call.2');
  // A preset with a group and no to is fine; a bad to is reported once, not as missing too.
  assert.deepEqual(plain(U.parseSlackPresets([G('g', '', ''), G('', 'group', '@x')])).errors, []);
  assert.deepEqual(plain(U.parseSlackPresets([G('g', '', ''), G('', 'to', 'x')])).errors.length, 1);
});

test('when and destination grammar', () => {
  assert.equal(U.slackParseWhen('0'), 0);
  assert.equal(U.slackParseWhen('-3d'), -3 * 1440);
  assert.equal(U.slackParseWhen('2h'), 120);
  assert.equal(U.slackParseWhen(' - 30m'), -30);
  assert.equal(U.slackParseWhen('1d12h'), 36 * 60);
  assert.equal(U.slackParseWhen('0.5d'), 720);
  assert.equal(U.slackParseWhen('1w'), null, 'weeks are not a when unit');
  assert.equal(U.slackParseWhen('1sl'), null);
  assert.equal(U.slackParseWhen(''), null);
  assert.equal(U.slackParseWhen('soon'), null);
  assert.deepEqual(plain(U.slackParseTo('#a; C1 ,{who}')), ['#a', 'C1', '{who}']);
  assert.equal(U.slackParseTo(''), null);
  assert.equal(U.slackParseTo('# a'), null);
  assert.equal(U.slackParseTo('c1'), null, 'ids are upper case');
  assert.equal(U.slackParseTo('alice'), null, 'a bare member id is not a destination');
  assert.deepEqual(plain(U.slackParseTo('a@b')), ['a@b']);
  assert.equal(U.slackParseTo('{who} now'), null);
  assert.equal(U.slackParseGroup('@oncall'), '@oncall');
  assert.equal(U.slackParseGroup('S0ABC'), 'S0ABC');
  assert.equal(U.slackParseGroup('s0abc'), null);
  assert.equal(U.slackParseGroup('@on call'), null);
  assert.equal(U.slackIsIdRow(['alice', 'id', 'U1']), true);
  assert.equal(U.slackIsIdRow(['', 'id', 'U1']), false, 'a setting named id belongs to a preset');
  assert.equal(U.slackIsIdRow(['p', '', 'note']), false);
});

test('readInputs: error rows written back once with the id rows in place, read-only storage untouched', () => {
  const rows = [G('alice', 'id', 'U1'), G('team', '', ''), G('', 'to', 'nope'), G('', 'group', '@oncall'), G('bob', 'id', 'U2'), G('x', '', '')];
  const storage = new MemoryStorage({ ledgers: ledger(BASE), tabs: { '#Slack': [['', 'error', 'stale'], ...rows] } });
  const inputs = plain(U.slack_readInputs(storage));
  assert.deepEqual(inputs.errors.map((e) => e.message), ['bad value for to: "nope"; use ' + U.SLACK_TO_HINT, 'preset "x" needs to or group']);
  assert.deepEqual(inputs.ids, { alice: 'U1', bob: 'U2' });
  assert.deepEqual(inputs.rows, rows);
  const withErrors = [
    ['alice', 'id', 'U1'], ['team', '', ''],
    ['', 'error', 'bad value for to: "nope"; use ' + U.SLACK_TO_HINT], ['', 'to', 'nope'],
    ['', 'group', '@oncall'], ['bob', 'id', 'U2'],
    ['', 'error', 'preset "x" needs to or group'], ['x', '', ''],
  ];
  assert.deepEqual(storage.tabs['#Slack'], withErrors);
  assert.deepEqual(plain(U.slack_readInputs(storage)).errors.length, 2);
  assert.deepEqual(storage.tabs['#Slack'], withErrors, 'second read identical');
  storage.writeTabRows = () => { throw new Error('must not write'); };
  U.slack_readInputs(storage);
  assert.deepEqual(plain(U.slack_readInputs({ readTabRows: () => rows })).presets.length, 2, 'a storage without writeTabRows only reads');
  const dir = path.join(__dirname, '..', '.tmp', 'slack-errors');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'slack.csv'), U.formatCsv([plain(U.PRESET_HEADER), ...rows]));
  U.slack_readInputs(new CsvDirStorage(dir, { readOnly: true }));
  assert.equal(fs.readFileSync(path.join(dir, 'slack.csv'), 'utf8'), U.formatCsv([plain(U.PRESET_HEADER), ...rows]));
  U.slack_readInputs(new CsvDirStorage(dir));
  assert.deepEqual(plain(new CsvDirStorage(dir).readTabRows(U.SLACK_TAB, U.PRESET_HEADER)), withErrors);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plan: bootstrap sends, a recorded shift is not resent, a reassignment is, neighbours do not matter', () => {
  const first = planFor(BASE + ', slack=team', TEAM);
  assert.deepEqual(first.result.errors, []);
  assert.deepEqual(first.plan.lines, [{ rotation: 'primary', preset: 'team', due: 1, skipped: 0 }]);
  assert.deepEqual(first.plan.messages, [{
    rotation: 'primary', preset: 'team', to: '#chan', start: '2026-10-05T09:00', end: '2026-10-12T09:00', who: 'alice',
    text: 'alice is on call for primary from 2026-10-05T09:00 to 2026-10-12T09:00',
    values: { who: 'alice', prev: '', next: 'bob', rotation: 'primary', start: dt('2026-10-05T09:00'), end: dt('2026-10-12T09:00'), note: '', pin: 'a', group: '@oncall' },
  }]);
  assert.deepEqual(first.plan.groups, [{ group: '@oncall', rotations: ['primary'], members: ['alice'] }]);
  assert.deepEqual(first.plan.warnings, []);
  // The block in Node: no slack, the message counted as due.
  assert.deepEqual(plain(first.result.status.ext.slack), {
    lines: [{ rotation: 'primary', preset: 'team', due: 1, posted: 0, skipped: 0, failed: 0 }],
    groups: [{ group: '@oncall', rotations: ['primary'], members: ['alice'], result: '' }],
    errors: [], mode: 'no slack', elapsed: 0,
  });
  const recorded = [['primary', 'team', '#chan', '2026-10-05T09:00', 'alice', '2026-10-05T02:00']];
  assert.deepEqual(planFor(BASE + ', slack=team', TEAM, recorded).plan.messages, [], 'same start and assignee: not sent again');
  // The neighbours change (carol replaces bob after alice's shift) but the recorded shift is the same: still not sent.
  const joined = ledger(BASE + ', slack=team');
  joined.primary.push(R('', '2026-10-06', 'team', 'alice, carol=0'));
  const neighbours = planFor(null, TEAM, recorded, { ledgers: joined });
  assert.equal(neighbours.result.status.shifts[1].who, 'carol');
  assert.deepEqual(neighbours.plan.messages, []);
  // A reassigned shift is announced again with the new person; another destination is a fresh one.
  const other = [['primary', 'team', '#chan', '2026-10-05T09:00', 'bob', '2026-10-05T02:00']];
  assert.deepEqual(planFor(BASE + ', slack=team', TEAM, other).plan.messages.map((m) => m.who), ['alice']);
  const elsewhere = [['primary', 'team', '#other', '2026-10-05T09:00', 'alice', '2026-10-05T02:00']];
  assert.equal(planFor(BASE + ', slack=team', TEAM, elsewhere).plan.messages.length, 1);
  // An earlier start recorded for the destination: the new shift is due.
  const older = [['primary', 'team', '#chan', '2026-09-28T09:00', 'alice', '2026-09-28T02:00']];
  assert.equal(planFor(BASE + ', slack=team', TEAM, older).plan.messages.length, 1);
});

test('plan: windows with negative and positive offsets, member destinations, empty ones skipped, prev and next', () => {
  // when=-3d: the window of the 10-05 shift is [10-02T09:00, 10-09T09:00); {prev} of the first shift is empty.
  const early = planFor(BASE + ', slack=heads', HEADS);
  assert.deepEqual(early.plan.lines, [{ rotation: 'primary', preset: 'heads', due: 1, skipped: 1 }]);
  assert.equal(early.plan.skipped, 1);
  assert.deepEqual(early.plan.messages.map((m) => [m.to, m.who, m.text]), [['alice', 'alice', 'Soon: alice after , then bob ()']]);
  // Three days later the 10-12 shift is inside its window: bob, previous alice, no next inside the horizon.
  const later = planFor(BASE + ', slack=heads', HEADS, [], { now: '2026-10-09T10:00' });
  assert.deepEqual(later.plan.messages.map((m) => [m.to, m.who, m.start, m.text]), [
    ['bob', 'bob', '2026-10-12T09:00', 'Soon: bob after alice, then  ()'],
    ['alice', 'bob', '2026-10-12T09:00', 'Soon: bob after alice, then  ()'],
  ]);
  assert.equal(later.plan.skipped, 0);
  // when=2d: at 10-13T10:00 the shift in force is bob's, but the window [10-07T09:00, 10-14T09:00) belongs to alice's.
  const AFTER = [G('after', '', ''), G('', 'to', 'C1'), G('', 'when', '2d'), G('', 'text', '{who} was on call; {next} is')];
  const after = planFor(BASE + ', slack=after', AFTER, [], { now: '2026-10-13T10:00' });
  assert.deepEqual(after.plan.messages.map((m) => [m.who, m.start, m.text]), [['alice', '2026-10-05T09:00', 'alice was on call; bob is']]);
  // Before any window: no message, the line stays.
  const none = planFor(BASE + ', slack=after', AFTER, [], { now: '2026-10-06T10:00' });
  assert.deepEqual(none.plan.lines, [{ rotation: 'primary', preset: 'after', due: 0, skipped: 0 }]);
  assert.deepEqual(none.plan.messages, []);
  // Several destinations of one preset, in order; a template value is escaped, a note travels.
  const MANY = [G('many', '', ''), G('', 'to', 'C1, {who}, U9'), G('', 'text', '{who} & {note} <{pin}>')];
  const noted = ledger(BASE + ', slack=many');
  noted.primary.push(R('x', '2026-10-05T09:00', 'shift', 'bob', '', '', 'a <b> & c'));
  const many = planFor(null, MANY, [], { ledgers: noted });
  assert.deepEqual(many.plan.messages.map((m) => m.to), ['C1', 'bob', 'U9']);
  // A destination rendering like an earlier one of the preset is skipped, so one state key gets one message.
  const DUP = [G('dup', '', ''), G('', 'to', '#chan, {who}, #chan, U5, {next}')];
  const same = ledger(BASE + ', slack=dup', 'alice');
  const dup = planFor(null, DUP, [], { ledgers: same });
  assert.deepEqual(dup.plan.messages.map((m) => m.to), ['#chan', 'alice', 'U5']);
  assert.deepEqual(dup.plan.lines, [{ rotation: 'primary', preset: 'dup', due: 3, skipped: 2 }]);
  assert.equal(many.plan.messages[0].text, 'bob & a &lt;b&gt; &amp; c <x>', 'values are escaped, the template is not');
  assert.equal(many.plan.messages[0].values.note, 'a <b> & c');
});

test('plan: nobody shifts, groups across rotations with a frozen one, empty group warning, errors', () => {
  // A pinned nobody shift covers now: no message, the group has nobody from primary.
  const gap = ledger(BASE + ', slack=team');
  gap.primary.push(R('x', '2026-10-05T09:00', 'shift', '-'));
  const nobody = planFor(null, TEAM, [], { ledgers: gap });
  assert.deepEqual(nobody.plan.messages, []);
  assert.deepEqual(nobody.plan.lines, [{ rotation: 'primary', preset: 'team', due: 0, skipped: 0 }]);
  assert.deepEqual(nobody.plan.groups, [{ group: '@oncall', rotations: ['primary'], members: [] }]);
  assert.deepEqual(nobody.plan.warnings, [
    { rotation: 'primary', message: 'group @oncall: nobody on call in primary' },
    { rotation: null, message: 'group @oncall: nobody on call, left as it is' },
  ]);
  assert.deepEqual(nobody.result.status.warnings.map((w) => [w.rotation, w.message]), [
    ['primary', 'group @oncall: nobody on call in primary'], ['Slack', 'group @oncall: nobody on call, left as it is'],
  ]);
  // Two rotations share the group through two presets; a frozen rotation (run scope) still counts, and its
  // hand-typed shift gives pin and note from the rows as read.
  const SECOND = [G('second', '', ''), G('', 'to', 'C2'), G('', 'group', '@oncall'), G('', 'text', '{who} [{pin}] {note}')];
  const two = {
    primary: ledger(BASE + ', slack=team').primary,
    secondary: [R('', '2026-10-05T09:00', 'set', BASE + ', slack=second'), R('', '2026-10-05T09:00', 'team', 'erin, frank'), R('x', '2026-10-05T09:00', 'shift', 'erin', '', '', 'swapped')],
  };
  const both = planFor(null, [...TEAM, ...SECOND], [], { ledgers: two });
  assert.deepEqual(both.plan.groups, [{ group: '@oncall', rotations: ['primary', 'secondary'], members: ['alice', 'erin'] }]);
  assert.deepEqual(both.plan.messages.map((m) => [m.rotation, m.text]), [['primary', 'alice is on call for primary from 2026-10-05T09:00 to 2026-10-12T09:00'], ['secondary', 'erin [x] swapped']]);
  const frozen = planFor(null, [...TEAM, ...SECOND], [], { ledgers: two, run: { rotations: ['primary'] } });
  assert.deepEqual(Object.keys(frozen.result.ledgers), ['primary']);
  assert.deepEqual(Object.keys(frozen.result.read), ['primary', 'secondary'], 'the runner keeps the rotations as read');
  assert.deepEqual(frozen.plan.groups, [{ group: '@oncall', rotations: ['primary', 'secondary'], members: ['alice', 'erin'] }]);
  assert.deepEqual(frozen.plan.messages.map((m) => [m.rotation, m.text]), [['primary', 'alice is on call for primary from 2026-10-05T09:00 to 2026-10-12T09:00'], ['secondary', 'erin [x] swapped']]);
  // The same member on call in both rotations appears once; a group-only preset makes no line.
  const same = { primary: ledger(BASE + ', slack=team').primary, secondary: [R('', '2026-10-05T09:00', 'set', BASE + ', slack=grp'), R('', '2026-10-05T09:00', 'team', 'alice')] };
  const GRP = [G('grp', '', ''), G('', 'group', '@oncall')];
  const shared = planFor(null, [...TEAM, ...GRP], [], { ledgers: same });
  assert.deepEqual(shared.plan.groups[0].members, ['alice']);
  assert.deepEqual(shared.plan.lines.map((l) => l.preset), ['team']);
  // From #Global too.
  const viaGlobal = planFor(BASE, TEAM, [], { global: [R('', '2026-10-05T09:00', 'set', 'slack=team')] });
  assert.equal(viaGlobal.plan.messages.length, 1);
  // Unknown and broken presets are errors of the plan and of the run; the input errors come first.
  const broken = planFor(BASE + ', slack=team nope broken', [...TEAM, G('broken', '', ''), G('', 'to', 'C9'), G('', 'when', 'x')]);
  assert.deepEqual(broken.plan.errors, [
    { row: 7, where: '#Slack row 8', message: 'bad value for when: "x"; use ' + U.SLACK_WHEN_HINT },
    { where: 'primary', rotation: 'primary', setting: 'slack', message: 'unknown preset "nope" in slack; add it to #Slack' },
    { where: 'primary', rotation: 'primary', message: 'preset "broken" skipped: bad value for when: "x"; use ' + U.SLACK_WHEN_HINT },
  ]);
  assert.deepEqual(broken.result.errors, [
    'Slack #Slack row 8: bad value for when: "x"; use ' + U.SLACK_WHEN_HINT,
    'Slack primary: unknown preset "nope" in slack; add it to #Slack',
    'Slack primary: preset "broken" skipped: bad value for when: "x"; use ' + U.SLACK_WHEN_HINT,
  ]);
  assert.equal(broken.plan.messages.length, 1, 'the valid preset still plans');
  // No slack setting: nothing planned, no block; input errors alone still give a block.
  const none = planFor(BASE, TEAM);
  assert.deepEqual(none.plan, { lines: [], messages: [], groups: [], skipped: 0, errors: [], warnings: [] });
  assert.equal(none.result.status.ext, undefined);
  const onlyErrors = planFor(BASE, [G('', 'to', '#x')]);
  assert.equal(onlyErrors.result.status.ext.slack.errors.length, 1);
  // Without a status (bad now) the plan is empty but keeps the input errors; the hook is skipped on slack: false.
  const bad = planFor(BASE + ', slack=team', TEAM, [], { now: 'someday' });
  assert.deepEqual(plain(U.slackPlan(bad.result, bad.result.ext.slack, [])), { lines: [], messages: [], groups: [], skipped: 0, errors: [], warnings: [] });
  assert.deepEqual(plain(U.slackPlan(null, null, null)).messages, []);
  const skipped = planFor(BASE + ', slack=team', TEAM, [], { run: { slack: false } });
  assert.equal(skipped.result.status.ext, undefined);
});

test('render: mentions from a resolver, escaping, destinations from member placeholders', () => {
  const values = { who: 'alice', prev: '', next: 'bob <x>', rotation: 'p & q', start: dt('2026-10-05'), end: dt('2026-10-12T09:00'), note: '', pin: '', group: '@oncall' };
  const mention = (kind, id) => (kind === 'member' && id === 'alice' ? '<@U1>' : kind === 'group' ? '<!subteam^S1>' : null);
  assert.equal(U.slackRenderText('{who}|{prev}|{next}|{rotation}|{start:%a}|{end}|{group}|{nope}', values, mention), '<@U1>||bob &lt;x&gt;|p &amp; q|Mon|2026-10-12T09:00|<!subteam^S1>|{nope}');
  assert.equal(U.slackRenderText(' {who} {group} ', values, null), 'alice @oncall');
  assert.equal(U.slackRenderTo('{who}', values), 'alice');
  assert.equal(U.slackRenderTo('{prev}', values), '');
  assert.equal(U.slackRenderTo('{Next}', values), 'bob <x>', 'destinations are not escaped');
  assert.equal(U.slackRenderTo('#chan', values), '#chan');
  assert.equal(U.slackEscape('a&b<c>'), 'a&amp;b&lt;c&gt;');
});

test('state rows: entries from rows, unknown pairs dropped, posted replace, sorted', () => {
  const rows = [
    ['secondary', 'second', 'C2', '2026-10-05T09:00', 'frank', '2026-10-05T09:30'],
    ['', '', '', '', '', ''],
    ['primary', 'team', '#chan', '2026-10-05', 'dave', '2026-10-05T02:10'],
    ['tertiary', 'team', '#chan', '2026-09-28', 'zed', '2026-09-28T02:10'],
    ['primary', 'old', '#old', '2026-09-28', 'carol', '2026-09-28T02:10'],
    ['primary', 'team', '{who}', '2026-09-28', 'carol', '2026-09-28T02:10'],
  ];
  const state = plain(U.slackStateFromRows(rows));
  assert.equal(state.length, 5);
  assert.deepEqual(state[1], { rotation: 'primary', preset: 'team', to: '#chan', start: '2026-10-05', who: 'dave', sentAt: '2026-10-05T02:10' });
  const posted = [
    { rotation: 'primary', preset: 'team', to: '#chan', start: '2026-10-12', who: 'alice', sentAt: '2026-10-12T02:00' },
    { rotation: 'primary', preset: 'heads', to: 'alice', start: '2026-10-12', who: 'alice', sentAt: '2026-10-12T02:00' },
  ];
  const known = { status: { rotations: [{ name: 'primary' }, { name: 'secondary' }] } };
  const presets = { presets: [{ name: 'team' }, { name: 'second' }, { name: 'heads' }] };
  assert.deepEqual(plain(U.slackStateRows(state, posted, known, presets)), [
    ['primary', 'heads', 'alice', '2026-10-12', 'alice', '2026-10-12T02:00'],
    ['primary', 'team', '#chan', '2026-10-12', 'alice', '2026-10-12T02:00'],
    ['primary', 'team', '{who}', '2026-09-28', 'carol', '2026-09-28T02:10'],
    ['secondary', 'second', 'C2', '2026-10-05T09:00', 'frank', '2026-10-05T09:30'],
  ]);
  assert.deepEqual(plain(U.slackStateRows([], [], known, presets)), []);
  assert.deepEqual(plain(U.slackStateRows(state, [], null, null)), []);
  assert.deepEqual(plain(U.slackStateFromRows(null)), []);
  assert.deepEqual(plain(U.SLACK_STATE_HEADER), ['rotation', 'preset', 'to', 'start', 'who', 'sent at']);
  const result = runDir(FIXTURE);
  assert.deepEqual(plain(U.slackStateRows(state, [], result, result.ext.slack)).map((r) => r.slice(0, 2)), [['primary', 'team'], ['primary', 'team'], ['secondary', 'second']]);
});

test('status block: data from the plan, rows through the core hook', () => {
  const result = runDir(FIXTURE);
  assert.deepEqual(result.errors, []);
  const data = plain(result.status.ext.slack);
  assert.deepEqual(data, {
    lines: [
      { rotation: 'primary', preset: 'team', due: 0, posted: 0, skipped: 0, failed: 0 },
      { rotation: 'primary', preset: 'heads-up', due: 1, posted: 0, skipped: 0, failed: 0 },
      { rotation: 'secondary', preset: 'second', due: 0, posted: 0, skipped: 0, failed: 0 },
    ],
    groups: [{ group: '@oncall', rotations: ['primary', 'secondary'], members: ['dave@example.com', 'frank'], result: '' }],
    errors: [], mode: 'no slack', elapsed: 0,
  });
  const block = plain(U.slack_status(result.status));
  assert.deepEqual(block, { rows: [
    ['Slack (no slack)', 'elapsed', '0 s'],
    ['rotation', 'preset', 'due', 'posted', 'skipped', 'failed'],
    ['primary', 'team', '0', '0', '0', '0'],
    ['primary', 'heads-up', '1', '0', '0', '0'],
    ['secondary', 'second', '0', '0', '0', '0'],
    ['group', 'rotations', 'members', 'result'],
    ['@oncall', 'primary, secondary', 'dave@example.com, frank', ''],
  ], headerRows: [0, 1, 5], errorRows: [], warningRows: [] });
  assert.match(statusText(result.status), /Slack \(no slack\)  elapsed +0 s\nrotation +preset +due +posted +skipped +failed\nprimary +team +0/);
  delete result.status.ext;
  assert.equal(U.slack_status(result.status), null, 'nothing without status.ext.slack');
  const filled = { ...data, mode: 'dry run', note: 'aborted after 1 message(s)', errors: [{ where: 'primary / team', message: 'channel_not_found' }] };
  filled.lines[1].posted = 1;
  filled.groups[0].result = 'updated';
  const rows = plain(U.slack_status({ ext: { slack: filled } }));
  assert.deepEqual(rows.rows.slice(5), [
    ['group', 'rotations', 'members', 'result'],
    ['@oncall', 'primary, secondary', 'dave@example.com, frank', 'updated'],
    ['note', 'aborted after 1 message(s)'],
    ['slack errors', 'where', 'message'],
    ['', 'primary / team', 'channel_not_found'],
  ]);
  assert.deepEqual(rows.headerRows, [0, 1, 5, 8]);
  assert.deepEqual(rows.errorRows, [9]);
  assert.equal(rows.rows[3][3], '1');
  assert.deepEqual(plain(U.slack_status({ ext: { slack: { lines: [] } } })), { rows: [['Slack'], ['rotation', 'preset', 'due', 'posted', 'skipped', 'failed']], headerRows: [0, 1], errorRows: [], warningRows: [] });
  // The rows reach #Status through the core with the error rows marked.
  const status = U.statusRows({ ...result.status, ext: { slack: filled } });
  const start = plain(status.rows).findIndex((r) => r[0] === 'Slack (dry run)');
  assert.ok(start > 0);
  assert.ok(plain(status.errorRows).includes(start + 9));
});

test('golden slack fixture: plan, state rows and CLI', () => {
  const { result, plan, state } = slackDir(FIXTURE, null, {});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(plan, JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected', 'slack.json'), 'utf8')));
  assert.equal(U.formatCsv([plain(U.SLACK_STATE_HEADER), ...state]), fs.readFileSync(path.join(FIXTURE, 'expected', 'slack-state.csv'), 'utf8'));
  // The hourly tick (slack: true without write) plans the same way in Node.
  const tick = runDir(FIXTURE, null, { slack: true });
  assert.deepEqual(plain(tick.status.ext.slack.lines).map((l) => l.due), [0, 1, 0]);
  // Run scope: with primary frozen its heads-up is still due and the group still unions both rotations.
  const scoped = slackDir(FIXTURE, null, { rotations: ['secondary'] });
  assert.deepEqual(Object.keys(scoped.result.ledgers), ['secondary']);
  assert.deepEqual(scoped.plan.messages.map((m) => [m.rotation, m.to]), [['primary', 'dave@example.com']]);
  assert.deepEqual(scoped.plan.groups[0].members, ['dave@example.com', 'frank']);
  // Plan text and the CLI command.
  const text = slackPlanText(plan, state);
  assert.match(text, /^rotation +preset +due +skipped\nprimary +team +0 +0\nprimary +heads-up +1 +0\nsecondary +second +0 +0\n\nmessage +rotation +preset +to +start +end +who +text\n +primary +heads-up +dave@example.com +2026-10-05 +2026-10-12 +dave@example.com +Reminder: you are on call for primary from Mon 5 Oct to Mon 12 Oct\n\ngroup +rotations +members\n@oncall +primary, secondary +dave@example.com, frank\n\nstate +rotation +preset +to +start +who +sent at\n/);
  assert.ok(!text.includes('warning') && !text.includes('error'));
  const withIssues = slackPlanText({ lines: [], messages: [], groups: [], skipped: 0, warnings: [{ rotation: null, message: 'group @x: nobody on call, left as it is' }], errors: [{ where: 'primary', message: 'unknown preset "x" in slack; add it to #Slack' }] }, []);
  assert.match(withIssues, /^warning +rotation +message\n +group @x: nobody on call, left as it is\n\nerror +where +message\n +primary +unknown preset/);
  const out = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(s); return true; };
  try {
    assert.equal(main(['slack', FIXTURE]), 0);
    assert.equal(main(['slack', FIXTURE, '--rotation', 'secondary']), 0);
    assert.equal(main(['slack', FIXTURE, '--bogus']), 1);
    assert.equal(main(['slack', FIXTURE, '--now', 'someday']), 1);
  } finally { process.stdout.write = write; }
  assert.match(out.join(''), /heads-up +1 +0\n/);
  assert.equal(slackDir(FIXTURE, 'someday', {}).plan, null);
  // A preset error makes run exit 1 and, with --write, writes the error row into slack.csv.
  const dir = path.join(__dirname, '..', '.tmp', 'slack-cli');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'slack.csv'), 'broken,,\n,to,C9\n,when,soon\n');
  const err = [];
  const writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = (s) => { err.push(s); return true; };
  try {
    assert.equal(main(['run', dir]), 1);
    assert.equal(fs.readFileSync(path.join(dir, 'slack.csv'), 'utf8').includes(',error,'), false, 'read-only without --write');
    assert.equal(main(['run', dir, '--write']), 1);
  } finally { process.stdout.write = write; process.stderr.write = writeErr; }
  assert.match(err.join(''), /Slack #Slack row 17: bad value for when: "soon"/);
  assert.match(fs.readFileSync(path.join(dir, 'slack.csv'), 'utf8'), /\n,error,"bad value for when: ""soon""[^\n]*\n,when,soon\n$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Mock of the UrlFetchApp, PropertiesService and Utilities surface the adapter uses. handlers: method to a
// response body, or a function (params, calls) giving one; a body with `status` other than 200 stands for an
// HTTP failure with its `headers`. Every call is logged as { method, params, request }.
function installSlack(handlers, token = 'xoxb-test') {
  const calls = [];
  const sleeps = [];
  U.UrlFetchApp = { fetch: (url, request) => {
    const method = url.slice('https://slack.com/api/'.length);
    const params = Object.fromEntries(new URLSearchParams(request.payload));
    calls.push({ method, params, request });
    const h = handlers[method];
    const body = typeof h === 'function' ? h(params, calls) : (h ?? { ok: false, error: 'unknown_method' });
    const status = body.status ?? 200;
    return {
      getResponseCode: () => status,
      getHeaders: () => body.headers ?? {},
      getContentText: () => (body.text !== undefined ? body.text : JSON.stringify(status === 200 ? body : { ok: false, error: 'ratelimited' })),
    };
  } };
  U.PropertiesService = { getScriptProperties: () => ({ getProperty: (key) => (key === 'rotalator.slack.token' ? token : null) }) };
  U.Utilities = { sleep: (ms) => sleeps.push(ms) };
  return { calls, sleeps };
}
function removeSlack() { delete U.UrlFetchApp; delete U.PropertiesService; delete U.Utilities; }
const DIRECTORY = {
  'conversations.list': (p) => (p.cursor ? { ok: true, channels: [{ id: 'C0CHAN', name: 'chan' }] } : { ok: true, channels: [{ id: 'C0OTHER', name: 'other' }], response_metadata: { next_cursor: 'p2' } }),
  'users.lookupByEmail': (p) => (p.email === 'dave@example.com' ? { ok: true, user: { id: 'U0DAVE' } } : { ok: false, error: 'users_not_found' }),
  'usergroups.list': { ok: true, usergroups: [{ id: 'S0ON', handle: 'oncall' }] },
  'chat.postMessage': { ok: true, ts: '1' },
};
const IDS = [G('alice', 'id', 'U0A'), G('bob', 'id', 'U0B')];
// A live run in memory: write by default, the #Slack rows given, the state rows given.
function liveRun(set, tabs, state = [], options = {}) {
  const storage = new MemoryStorage({ ledgers: options.ledgers || ledger(set), global: options.global || [], tabs: { '#Slack': tabs, '#Slack state': state } });
  const result = runStorage(storage, options.now || NOW, { write: true, ...(options.run || {}) });
  return { result, storage, data: result.status?.ext?.slack ? plain(result.status.ext.slack) : null };
}

test('slackApi: request shape, bearer token, ok:false mapping with hints, 429 retried once, no token', () => {
  let refusals = 0;
  const { calls, sleeps } = installSlack({
    'chat.postMessage': (p) => (p.channel === 'C1' ? { ok: true, ts: '1.2' } : { ok: false, error: p.channel }),
    'usergroups.users.update': () => (refusals++ < 1 ? { status: 429, headers: { 'Retry-After': '7' } } : { ok: true }),
    'usergroups.users.list': { status: 429, headers: {} },
    'auth.test': { status: 500, text: 'gateway' },
  });
  try {
    assert.deepEqual(plain(U.slackApi('chat.postMessage', { channel: 'C1', text: 'a & b=c', unset: undefined, gone: null })), { ok: true, ts: '1.2' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].request.method, 'post');
    assert.equal(calls[0].request.contentType, 'application/x-www-form-urlencoded');
    assert.deepEqual(plain(calls[0].request.headers), { Authorization: 'Bearer xoxb-test' });
    assert.equal(calls[0].request.muteHttpExceptions, true);
    assert.equal(calls[0].request.payload, 'channel=C1&text=a%20%26%20b%3Dc');
    assert.throws(() => U.slackApi('chat.postMessage', { channel: 'channel_not_found' }), { message: 'chat.postMessage: channel_not_found' });
    assert.throws(() => U.slackApi('chat.postMessage', { channel: 'not_in_channel' }), { message: 'chat.postMessage: not_in_channel; invite the bot to the channel or grant chat:write.public' });
    assert.throws(() => U.slackApi('chat.postMessage', { channel: 'invalid_auth' }), { message: 'chat.postMessage: invalid_auth; set the bot token with Set Slack token' });
    // 429: sleep Retry-After seconds, retry once, succeed.
    assert.deepEqual(plain(U.slackApi('usergroups.users.update', { usergroup: 'S1', users: 'U1,U2' })), { ok: true });
    assert.deepEqual(sleeps, [7000]);
    assert.deepEqual(calls.slice(-2).map((c) => c.params), [{ usergroup: 'S1', users: 'U1,U2' }, { usergroup: 'S1', users: 'U1,U2' }]);
    // Refused twice: one second by default, then the failure.
    assert.throws(() => U.slackApi('usergroups.users.list', { usergroup: 'S1' }), { message: 'usergroups.users.list: ratelimited' });
    assert.deepEqual(sleeps, [7000, 1000]);
    assert.equal(calls.length, 8);
    assert.throws(() => U.slackApi('auth.test'), { message: 'auth.test: HTTP 500' });
    assert.equal(calls[calls.length - 1].request.payload, '');
    // Without a token nothing is fetched.
    installSlack({}, null);
    assert.throws(() => U.slackApi('auth.test'), { message: 'auth.test: no Slack token; set the bot token with Set Slack token' });
  } finally { removeSlack(); }
});

test('resolver: ids as they are, lookups cached as id rows in lookup order, listings fetched once, unresolved forms', () => {
  const { calls } = installSlack(DIRECTORY);
  try {
    const r = U.slackResolver({ alice: 'U0A', '#cached': 'C9' });
    assert.equal(r.resolve('U1'), 'U1');
    assert.equal(r.resolve('W1'), 'W1');
    assert.equal(r.resolve('C1'), 'C1');
    assert.equal(r.resolve('G1'), 'G1');
    assert.equal(r.resolve('S1'), 'S1');
    assert.equal(r.resolve('alice'), 'U0A');
    assert.equal(r.resolve('#cached'), 'C9');
    assert.equal(r.resolve('bob'), null, 'a bare member id needs an id row');
    assert.deepEqual(calls, []);
    assert.equal(r.resolve('dave@example.com'), 'U0DAVE');
    assert.deepEqual(calls.map((c) => [c.method, c.params]), [['users.lookupByEmail', { email: 'dave@example.com' }]]);
    assert.equal(r.resolve('dave@example.com'), 'U0DAVE');
    assert.equal(calls.length, 1, 'cached');
    assert.equal(r.resolve('#chan'), 'C0CHAN');
    assert.deepEqual(calls.slice(1).map((c) => c.params), [
      { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000' },
      { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000', cursor: 'p2' },
    ]);
    assert.equal(r.resolve('#other'), 'C0OTHER');
    assert.equal(r.resolve('#nope'), null);
    assert.equal(calls.length, 3, 'the channel listing is fetched once');
    assert.equal(r.resolve('@oncall'), 'S0ON');
    assert.equal(r.resolve('@nope'), null);
    assert.deepEqual(calls.slice(3).map((c) => c.method), ['usergroups.list']);
    assert.throws(() => r.resolve('zed@example.com'), { message: 'users.lookupByEmail: users_not_found' });
    assert.deepEqual(plain(r.rows()), [['dave@example.com', 'id', 'U0DAVE'], ['#chan', 'id', 'C0CHAN'], ['#other', 'id', 'C0OTHER'], ['@oncall', 'id', 'S0ON']]);
    assert.equal(U.slackUnresolvedMessage('#x'), 'channel "#x" not found; use its id, or invite the bot when it is private');
    assert.equal(U.slackUnresolvedMessage('@x'), 'user group "@x" not found');
    assert.equal(U.slackUnresolvedMessage('bob'), 'member "bob" has no Slack id; add a row "bob | id | U..."');
    assert.deepEqual(plain(U.slackResolver(null).rows()), []);
  } finally { removeSlack(); }
});

test('afterRun live: posts to a channel and a person with mentions, writes the state and the id rows, group compared then updated', () => {
  let members = ['U0B'];
  const { calls } = installSlack({ ...DIRECTORY, 'usergroups.users.list': () => ({ ok: true, users: members }), 'usergroups.users.update': (p) => { members = p.users.split(','); return { ok: true }; } });
  try {
    const MENTION = [G('team', '', 'note'), G('', 'to', '#chan, {who}'), G('', 'text', '{who} on, {prev} off, {group}'), G('', 'group', '@oncall')];
    const tabs = [...MENTION, ...IDS];
    const { result, storage, data } = liveRun(BASE + ', slack=team', tabs);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(calls.map((c) => [c.method, c.params]), [
      ['conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000' }],
      ['conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000', cursor: 'p2' }],
      ['usergroups.list', {}],
      ['chat.postMessage', { channel: 'C0CHAN', text: '<@U0A> on,  off, <!subteam^S0ON>' }],
      ['chat.postMessage', { channel: 'U0A', text: '<@U0A> on,  off, <!subteam^S0ON>' }],
      ['usergroups.users.list', { usergroup: 'S0ON' }],
      ['usergroups.users.update', { usergroup: 'S0ON', users: 'U0A' }],
    ]);
    assert.deepEqual(data, {
      lines: [{ rotation: 'primary', preset: 'team', due: 2, posted: 2, skipped: 0, failed: 0 }],
      groups: [{ group: '@oncall', rotations: ['primary'], members: ['alice'], result: 'updated' }],
      errors: [], elapsed: 0,
    });
    assert.deepEqual(storage.tabs['#Slack state'], [
      ['primary', 'team', '#chan', '2026-10-05T09:00', 'alice', NOW],
      ['primary', 'team', 'alice', '2026-10-05T09:00', 'alice', NOW],
    ]);
    assert.deepEqual(storage.tabs['#Slack'], [...tabs, G('#chan', 'id', 'C0CHAN'), G('@oncall', 'id', 'S0ON')]);
    assert.deepEqual(result.status.warnings, []);
    // The next run from the written tabs: no lookups, nothing due, the group unchanged, nothing written.
    calls.length = 0;
    const again = liveRun(null, storage.tabs['#Slack'], storage.tabs['#Slack state'], { ledgers: storage.ledgers });
    assert.deepEqual(calls.map((c) => c.method), ['usergroups.users.list']);
    assert.deepEqual(again.data.lines, [{ rotation: 'primary', preset: 'team', due: 0, posted: 0, skipped: 0, failed: 0 }]);
    assert.equal(again.data.groups[0].result, 'unchanged');
    assert.deepEqual(again.storage.tabs, storage.tabs);
  } finally { removeSlack(); }
});

test('afterRun live: a failed post is not recorded and is retried next run; errors above the to row; unresolved destinations', () => {
  const handlers = { ...DIRECTORY, 'chat.postMessage': (p) => (p.channel === 'C0CHAN' ? { ok: false, error: 'not_in_channel' } : { ok: true }) };
  const { calls } = installSlack(handlers);
  try {
    const TWO = [G('team', '', ''), G('', 'to', '#chan, U0X'), G('heads', '', ''), G('', 'to', '{who}, {next}, zed@example.com')];
    const first = liveRun(BASE + ', slack=team heads', TWO);
    assert.deepEqual(first.result.errors, [
      'Slack primary / team: chat.postMessage: not_in_channel; invite the bot to the channel or grant chat:write.public',
      'Slack primary / heads: member "alice" has no Slack id; add a row "alice | id | U..."',
      'Slack primary / heads: member "bob" has no Slack id; add a row "bob | id | U..."',
      'Slack primary / heads: users.lookupByEmail: users_not_found',
    ]);
    assert.deepEqual(first.data.lines, [
      { rotation: 'primary', preset: 'team', due: 2, posted: 1, skipped: 0, failed: 1 },
      { rotation: 'primary', preset: 'heads', due: 3, posted: 0, skipped: 0, failed: 3 },
    ]);
    assert.deepEqual(first.storage.tabs['#Slack state'], [['primary', 'team', 'U0X', '2026-10-05T09:00', 'alice', NOW]], 'the success only');
    assert.deepEqual(first.storage.tabs['#Slack'], [
      G('team', '', ''),
      G('', 'error', 'chat.postMessage: not_in_channel; invite the bot to the channel or grant chat:write.public (primary / team)'),
      G('', 'to', '#chan, U0X'),
      G('heads', '', ''),
      G('', 'error', 'member "alice" has no Slack id; add a row "alice | id | U..." (primary / heads)'),
      G('', 'error', 'member "bob" has no Slack id; add a row "bob | id | U..." (primary / heads)'),
      G('', 'error', 'users.lookupByEmail: users_not_found (primary / heads)'),
      G('', 'to', '{who}, {next}, zed@example.com'),
      G('#chan', 'id', 'C0CHAN'),
    ]);
    assert.equal(calls.filter((c) => c.method === 'chat.postMessage').length, 2, 'unresolved destinations make no post');
    // Next run: the bot is in the channel and alice has an id row; the failed ones are still due, U0X is not.
    handlers['chat.postMessage'] = { ok: true };
    calls.length = 0;
    const second = liveRun(null, [...first.storage.tabs['#Slack'], G('alice', 'id', 'U0A')], first.storage.tabs['#Slack state'], { ledgers: first.storage.ledgers });
    assert.deepEqual(calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.params.channel), ['C0CHAN', 'U0A']);
    assert.deepEqual(second.result.errors, [
      'Slack primary / heads: member "bob" has no Slack id; add a row "bob | id | U..."',
      'Slack primary / heads: users.lookupByEmail: users_not_found',
    ]);
    assert.deepEqual(second.storage.tabs['#Slack state'].map((r) => r[2]), ['alice', '#chan', 'U0X']);
    assert.equal(second.storage.tabs['#Slack'].filter((r) => r[1] === 'error').length, 2, 'error rows recomputed');
  } finally { removeSlack(); }
});

test('afterRun live: group failure above the group row, unresolved member warned, empty group left alone, no update when equal', () => {
  const handlers = { ...DIRECTORY, 'usergroups.users.list': { ok: true, users: ['U0A', 'U0B'] }, 'usergroups.users.update': { ok: false, error: 'permission_denied' } };
  const { calls } = installSlack(handlers);
  try {
    const GROUPS = [G('team', '', ''), G('', 'to', 'C1'), G('', 'group', '@oncall'), G('two', '', ''), G('', 'group', 'S0TWO'), G('', 'to', 'C2')];
    const two = { primary: ledger(BASE + ', slack=team').primary, secondary: [R('', '2026-10-05T09:00', 'set', BASE + ', slack=two'), R('', '2026-10-05T09:00', 'team', 'erin')] };
    const run = liveRun(null, [...GROUPS, ...IDS], [], { ledgers: two });
    assert.deepEqual(run.result.errors, ['Slack group @oncall: usergroups.users.update: permission_denied']);
    assert.deepEqual(run.data.groups.map((g) => [g.group, g.members, g.result]), [['@oncall', ['alice'], 'failed'], ['S0TWO', ['erin'], '']]);
    assert.deepEqual(run.result.status.warnings.map((w) => [w.rotation, w.message]), [['Slack', 'group S0TWO: member "erin" has no Slack id; add a row "erin | id | U..."'], ['Slack', 'group S0TWO: no member has a Slack id, left as it is']]);
    assert.deepEqual(run.storage.tabs['#Slack'].slice(0, 3), [G('team', '', ''), G('', 'to', 'C1'), G('', 'error', 'usergroups.users.update: permission_denied (group @oncall)')]);
    assert.deepEqual(calls.filter((c) => c.method.startsWith('usergroups.users')).map((c) => c.params), [{ usergroup: 'S0ON' }, { usergroup: 'S0ON', users: 'U0A' }]);
    // Equal membership in any order: compared, not updated.
    calls.length = 0;
    handlers['usergroups.users.list'] = { ok: true, users: ['U0B', 'U0A'] };
    const pair = liveRun(null, [...GROUPS, ...IDS], [], { ledgers: { ...two, primary: ledger(BASE + ', slack=team', 'alice').primary, secondary: [R('', '2026-10-05T09:00', 'set', BASE + ', slack=team'), R('', '2026-10-05T09:00', 'team', 'bob')] } });
    assert.deepEqual(pair.data.groups, [{ group: '@oncall', rotations: ['primary', 'secondary'], members: ['alice', 'bob'], result: 'unchanged' }]);
    assert.deepEqual(calls.filter((c) => c.method.startsWith('usergroups.users')).map((c) => c.method), ['usergroups.users.list']);
    // Nobody on call: the plan's warning, no group call at all.
    calls.length = 0;
    const gap = ledger(BASE + ', slack=team');
    gap.primary.push(R('x', '2026-10-05T09:00', 'shift', '-'));
    const empty = liveRun(null, [...GROUPS.slice(0, 3), ...IDS], [], { ledgers: gap });
    assert.deepEqual(calls, []);
    assert.equal(empty.data.groups[0].result, '');
    assert.deepEqual(empty.result.status.warnings.map((w) => w.message), ['group @oncall: nobody on call in primary', 'group @oncall: nobody on call, left as it is']);
  } finally { removeSlack(); }
});

test('afterRun live: the run guard stops between posts, the rest waits; dry run and non-writing runs make no calls; the hourly tick posts', () => {
  let abort = false;
  const { calls } = installSlack({ ...DIRECTORY, 'usergroups.users.list': { ok: true, users: [] }, 'usergroups.users.update': { ok: true }, 'chat.postMessage': () => { abort = true; return { ok: true }; } });
  U.activeRunGuard = U.runGuard({ start: 0, clock: () => 3000, aborted: () => abort });
  try {
    const tabs = [...TEAM, G('', 'to', 'C1, C2'), ...IDS];
    tabs.splice(1, 1);
    const stopped = liveRun(BASE + ', slack=team', tabs);
    // The group handle is resolved for the text's values before the first post; the guard is asked from then on.
    assert.deepEqual(calls.map((c) => c.method), ['usergroups.list', 'chat.postMessage']);
    assert.deepEqual(stopped.data.lines, [{ rotation: 'primary', preset: 'team', due: 2, posted: 1, skipped: 0, failed: 0 }]);
    assert.equal(stopped.data.note, 'aborted after 1 message(s)');
    assert.equal(stopped.data.elapsed, 3);
    assert.equal(stopped.data.groups[0].result, '', 'the group waits too');
    assert.deepEqual(stopped.result.status.warnings.map((w) => [w.rotation, w.message]), [['Slack', 'aborted after 1 message(s)']]);
    assert.deepEqual(stopped.storage.tabs['#Slack state'].map((r) => r[2]), ['C1']);
    assert.deepEqual(stopped.result.errors, []);
    // Budget already used: nothing posted, the note says so.
    abort = false;
    calls.length = 0;
    U.activeRunGuard = U.runGuard({ start: 0, budgetSeconds: 1, clock: () => 5000 });
    const budget = liveRun(BASE + ', slack=team', tabs);
    assert.deepEqual(calls, []);
    assert.equal(budget.data.note, 'time budget reached after 0 message(s); the next run continues');
    assert.deepEqual(budget.storage.tabs['#Slack state'], []);
    U.activeRunGuard = null;
    // Dry run: the block is marked, no call, no state; a run without write likewise; the tick posts without writing ledgers.
    const dry = liveRun(BASE + ', slack=team', tabs, [], { run: { mode: 'dry run' } });
    assert.deepEqual(calls, []);
    assert.equal(dry.data.mode, 'dry run');
    assert.deepEqual(dry.storage.tabs['#Slack state'], []);
    assert.deepEqual(dry.storage.tabs['#Slack'], tabs);
    const noWrite = liveRun(BASE + ', slack=team', tabs, [], { run: { write: false } });
    assert.deepEqual(calls, []);
    assert.equal(noWrite.data.mode, 'dry run');
    const tick = liveRun(BASE + ', slack=team', tabs, [], { run: { write: false, slack: true } });
    assert.deepEqual(calls.map((c) => c.method), ['usergroups.list', 'chat.postMessage', 'chat.postMessage', 'usergroups.users.list', 'usergroups.users.update']);
    assert.equal(tick.data.mode, undefined);
    assert.deepEqual(tick.data.lines[0].posted, 2);
    assert.deepEqual(tick.storage.tabs['#Slack state'].map((r) => r[2]), ['C1', 'C2']);
    assert.deepEqual(tick.storage.ledgers, ledger(BASE + ', slack=team'), 'the tick leaves the ledgers alone');
    assert.equal(tick.storage.status, null);
    assert.equal(liveRun(BASE + ', slack=team', tabs, [], { run: { slack: false } }).data, null);
  } finally { U.activeRunGuard = null; removeSlack(); }
});

test('in-place errors: the slack value errors go above the set row that carries slack, in the ledger or #Global', () => {
  const ERR = (start, what) => R('', start, 'error', what);
  const mem = liveRun(BASE + ', slack=team nope', TEAM);
  assert.deepEqual(mem.result.errors, ['Slack primary: unknown preset "nope" in slack; add it to #Slack']);
  assert.deepEqual(mem.storage.ledgers.primary.slice(0, 2), [ERR('2026-10-05T09:00', 'unknown preset "nope" in slack; add it to #Slack'), R('', '2026-10-05T09:00', 'set', BASE + ', slack=team nope')]);
  assert.deepEqual(mem.result.ledgers.primary, mem.storage.ledgers.primary);
  // The second run drops and rewrites it identically; a preset with its own errors is not repeated here.
  const again = liveRun(null, TEAM, [], { ledgers: mem.storage.ledgers });
  assert.deepEqual(again.storage.ledgers, mem.storage.ledgers);
  const broken = liveRun(BASE + ', slack=team broken', [...TEAM, G('broken', '', ''), G('', 'to', 'C9'), G('', 'when', 'x')]);
  assert.ok(!broken.storage.ledgers.primary.some((r) => r[2] === 'error'));
  // From #Global, prefixed with the rotation; a dry run writes nothing.
  const viaGlobal = liveRun(BASE, TEAM, [], { global: [R('', '2026-10-05T09:00', 'set', 'slack=nope')] });
  assert.deepEqual(viaGlobal.storage.global, [ERR('2026-10-05T09:00', 'primary: unknown preset "nope" in slack; add it to #Slack'), R('', '2026-10-05T09:00', 'set', 'slack=nope')]);
  assert.ok(!viaGlobal.storage.ledgers.primary.some((r) => r[2] === 'error'));
  const dry = liveRun(BASE + ', slack=nope', TEAM, [], { run: { write: false } });
  assert.ok(!dry.storage.ledgers.primary.some((r) => r[2] === 'error'));
});
