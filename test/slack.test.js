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
