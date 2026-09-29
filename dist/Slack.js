// ---- 10_presets.js ----
// Slack extension: presets from the #Slack tab or slack.csv (DESIGN 14.1). The tab grammar is the core's
// parsePresetTab (72_presets.js); this file supplies the settings table, the value parsers and the id rows.
// Everything of the extension is prefixed slack.
var SLACK_DEFAULT_TEXT = '{who} is on call for {rotation} from {start} to {end}';
var SLACK_PLACEHOLDERS = ['who', 'prev', 'next', 'rotation', 'start', 'end', 'note', 'pin', 'group'];
var SLACK_MEMBER_PLACEHOLDERS = ['who', 'prev', 'next'];
var SLACK_ID_TYPE = 'id';
var SLACK_TO_HINT = 'comma-separated destinations: a channel id (C..., G...), #channel, an email, a user id (U..., W...) or {who}, {prev}, {next}';
var SLACK_WHEN_HINT = 'a signed clock interval relative to the shift start like 0, -3d, 2h or 1d12h (units d, h, m)';
var SLACK_GROUP_HINT = 'a user group as @handle or its id S...';

function slackIsChannelId(text) {
  return /^[CG][A-Z0-9]+$/.test(text);
}

function slackIsUserId(text) {
  return /^[UW][A-Z0-9]+$/.test(text);
}

function slackIsGroupId(text) {
  return /^S[A-Z0-9]+$/.test(text);
}

function slackIsEmail(text) {
  return /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(text);
}

function slackIsChannelName(text) {
  return /^#[^\s,;<>]+$/.test(text);
}

// One destination: an id, a #channel, an email or a single placeholder (checked as a template afterwards).
function slackIsDestination(text) {
  return slackIsChannelId(text) || slackIsUserId(text) || slackIsChannelName(text) || slackIsEmail(text) || /^\{[A-Za-z]+\}$/.test(text);
}

// to: the list of destination templates; null when empty or when an item is none of the forms.
function slackParseTo(text) {
  var items = splitList(text);
  return items.length && items.every(slackIsDestination) ? items : null;
}

// when: signed clock interval in minutes; a leading - puts the window before the shift start.
function slackParseWhen(text) {
  var t = text.trim();
  var sign = 1;
  if (t.charAt(0) === '-') { sign = -1; t = t.slice(1).trim(); }
  // parseDuration accepts weeks; when does not.
  if (/w/i.test(t)) return null;
  var minutes = parseDuration(t);
  return minutes === null ? null : sign * minutes;
}

function slackParseText(text) {
  return text === '' ? null : text;
}

function slackParseGroup(text) {
  return /^@[^\s@,;<>]+$/.test(text) || slackIsGroupId(text) ? text : null;
}

// parse returns null on a bad value; def is the value of an unset setting; to and text are templates
// (core parsePresetTab), to with the member placeholders only.
var SLACK_SETTINGS = {
  to:    { parse: slackParseTo,    def: [],                 hint: SLACK_TO_HINT, template: true, placeholders: SLACK_MEMBER_PLACEHOLDERS },
  when:  { parse: slackParseWhen,  def: 0,                  hint: SLACK_WHEN_HINT },
  text:  { parse: slackParseText,  def: SLACK_DEFAULT_TEXT, template: true },
  group: { parse: slackParseGroup, def: null,               hint: SLACK_GROUP_HINT },
};

// A preset must send a message or keep a group; a to or group row that failed to parse is reported already.
function slackCheckPreset(preset) {
  var given = preset.setRows.to !== undefined || preset.setRows.group !== undefined;
  return given ? null : 'preset "' + preset.name + '" needs to or group';
}

// <name> | id | <Slack id>: a cached resolution (DESIGN 14.4), script-owned and never a preset row.
function slackIsIdRow(cells) {
  return cellText(cells[0]) !== '' && cellText(cells[1]).toLowerCase() === SLACK_ID_TYPE;
}

// { presets, errors, ids }: the core grammar over the rows with the id rows blanked so row numbers hold, and
// the id rows as a name to id map.
function parseSlackPresets(rows) {
  var ids = {};
  var cleaned = (rows || []).map(function (cells) {
    if (!slackIsIdRow(cells)) return cells;
    ids[cellText(cells[0])] = cellText(cells[2]);
    return ['', '', ''];
  });
  var out = parsePresetTab(cleaned, SLACK_SETTINGS, { tab: SLACK_TAB, placeholders: SLACK_PLACEHOLDERS, check: slackCheckPreset });
  out.ids = ids;
  return out;
}

function slackPreset(inputs, name) {
  return (inputs && inputs.presets || []).find(function (p) { return p.name === name; }) || null;
}

// Hook: the extension's inputs, read through the storage before the run (DESIGN 8, Extensions). Error rows
// of the previous run are dropped first; when the presets have errors, or error rows were dropped, the tab is
// written back with an error row above each offending row (13.1), id rows kept in place. A storage that only
// reads gets no write.
function slack_readInputs(storage) {
  var read = typeof storage.readTabRows === 'function' ? storage.readTabRows(SLACK_TAB, PRESET_HEADER) : [];
  var rows = dropPresetErrorRows(read);
  var inputs = parseSlackPresets(rows);
  inputs.rows = rows;
  if (typeof storage.writeTabRows === 'function') {
    var written = presetRowsWithErrors(rows, inputs.errors);
    if (JSON.stringify(written) !== JSON.stringify(presetRowsWithErrors(read, []))) storage.writeTabRows(SLACK_TAB, PRESET_HEADER, written);
  }
  return inputs;
}

// ---- 20_plan.js ----
// Slack extension: the plan and the state, pure (DESIGN 14.2, 14.3). Due messages and desired group members
// from the runner's result, the parsed presets and the #Slack state rows; the adapter posts and updates.
var SLACK_STATE_HEADER = ['rotation', 'preset', 'to', 'start', 'who', 'sent at'];

// Slack markup escapes for template values; mentions are built by the adapter and never escaped.
function slackEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Message text from a template and the shift's values. mention(kind, id) with kind 'member' or 'group'
// returns the Slack mention (<@U...>, <!subteam^S...>) or null; the plan renders with null, so member ids and
// the group handle stay verbatim, and the adapter re-renders from the message's values once ids are resolved.
function slackRenderText(template, values, mention) {
  var out = {};
  Object.keys(values).forEach(function (name) {
    var value = values[name];
    if (TEMPLATE_INSTANTS.indexOf(name) >= 0) { out[name] = value; return; }
    if (value === null || value === undefined || value === '') { out[name] = ''; return; }
    var kind = SLACK_MEMBER_PLACEHOLDERS.indexOf(name) >= 0 ? 'member' : name === 'group' ? 'group' : null;
    var mentioned = kind && mention ? mention(kind, value) : null;
    out[name] = mentioned === null || mentioned === undefined ? slackEscape(value) : mentioned;
  });
  return formatTemplate(template, out).text.trim();
}

// A destination from its template: member placeholders give the member id, resolved later like a literal.
function slackRenderTo(template, values) {
  var members = {};
  SLACK_MEMBER_PLACEHOLDERS.forEach(function (name) { members[name] = values[name]; });
  return formatTemplate(template, members).text.trim();
}

// Shifts of a rotation in start order: start, end and assignee from the status (the swept extents), pin and
// note from the written rows, or from the rows as read for a rotation the run did not write (frozen).
function slackRotationShifts(run, name) {
  var cells = run.ledgers[name] || (run.read || {})[name] || [];
  var byStart = {};
  rowsFromCells(cells).forEach(function (r) { if (r.type === 'shift' && r.start !== null) byStart[r.start] = r; });
  return run.status.shifts.filter(function (s) { return s.rotation === name; }).map(function (s) {
    var row = byStart[s.start];
    return { start: s.start, end: s.end, who: s.who, pin: row ? row.pin : '', note: row ? row.note : '' };
  }).sort(function (a, b) { return a.start - b.start; });
}

// Presets named by the rotation's slack value, in order; unknown names and presets with errors are reported
// and skipped. Errors the slack value itself causes carry setting: 'slack' (DESIGN 6).
function slackRotationPresets(value, inputs, rotation, errors) {
  var out = [];
  (value === '' ? [] : value.split(' ')).forEach(function (name) {
    var preset = slackPreset(inputs, name);
    if (!preset) errors.push({ where: rotation, rotation: rotation, setting: 'slack', message: 'unknown preset "' + name + '" in slack; add it to ' + SLACK_TAB });
    else if (preset.errors.length) errors.push({ where: rotation, rotation: rotation, message: 'preset "' + name + '" skipped: ' + preset.errors.join('; ') });
    else out.push(preset);
  });
  return out;
}

function slackShiftValues(rotation, shifts, i, group) {
  var shift = shifts[i];
  return {
    who: shift.who,
    prev: i > 0 ? shifts[i - 1].who : '',
    next: i + 1 < shifts.length ? shifts[i + 1].who : '',
    rotation: rotation,
    start: shift.start,
    end: shift.end,
    note: shift.note,
    pin: shift.pin,
    group: group === null ? '' : group,
  };
}

function slackStateEntry(state, rotation, preset, to) {
  return (state || []).find(function (r) { return r.rotation === rotation && r.preset === preset && r.to === to; }) || null;
}

// run: the runner's result (DESIGN 8) after a run without errors; inputs: parseSlackPresets output; state:
// the #Slack state entries (slackStateFromRows). Every rotation the run read is considered, frozen ones
// included. Returns { lines: [{ rotation, preset, due, skipped }], messages: [{ rotation, preset, to, start,
// end, who, text, values }], groups: [{ group, rotations, members }], skipped, errors, warnings }: a line
// per rotation and message preset in force; messages in rotation, preset, destination order for the shift
// whose window [start + when, end + when) contains now, when the state has no row for the destination or
// the row names another start or assignee; a destination that renders empty or repeats one of the same
// preset is skipped; groups with the assignees on call now across their rotations.
function slackPlan(run, inputs, state) {
  var plan = { lines: [], messages: [], groups: [], skipped: 0, errors: (inputs && inputs.errors || []).slice(), warnings: [] };
  if (!run || !run.status || run.status.at === null || run.status.at === undefined) return plan;
  var now = run.status.at;
  var groups = {};
  var order = [];
  run.status.rotations.forEach(function (rot) {
    var setting = rot.settings.values.find(function (s) { return s.key === 'slack'; });
    var presets = slackRotationPresets(setting ? setting.value : '', inputs, rot.name, plan.errors);
    if (!presets.length) return;
    var shifts = slackRotationShifts(run, rot.name);
    var current = shifts.find(function (s) { return s.start <= now && now < s.end; }) || null;
    presets.forEach(function (preset) {
      if (preset.group !== null) {
        var g = groups[preset.group];
        if (!g) { g = groups[preset.group] = { group: preset.group, rotations: [], members: [], nobody: [] }; order.push(preset.group); }
        if (g.rotations.indexOf(rot.name) < 0) g.rotations.push(rot.name);
        if (current && current.who !== '') { if (g.members.indexOf(current.who) < 0) g.members.push(current.who); }
        else if (g.nobody.indexOf(rot.name) < 0) g.nobody.push(rot.name);
      }
      if (!preset.to.length) return;
      var line = { rotation: rot.name, preset: preset.name, due: 0, skipped: 0 };
      plan.lines.push(line);
      var i = shifts.findIndex(function (s) { return s.start + preset.when <= now && now < s.end + preset.when; });
      if (i < 0 || shifts[i].who === '') return;
      var values = slackShiftValues(rot.name, shifts, i, preset.group);
      var seen = {};
      preset.to.forEach(function (dest) {
        var to = slackRenderTo(dest, values);
        if (to === '' || seen[to]) { line.skipped++; plan.skipped++; return; }
        seen[to] = true;
        var recorded = slackStateEntry(state, rot.name, preset.name, to);
        if (recorded && recorded.start === formatDateTime(values.start) && recorded.who === values.who) return;
        line.due++;
        plan.messages.push({
          rotation: rot.name, preset: preset.name, to: to,
          start: formatDateTime(values.start), end: formatDateTime(values.end), who: values.who,
          text: slackRenderText(preset.text, values, null), values: values,
        });
      });
    });
  });
  order.forEach(function (name) {
    var g = groups[name];
    g.nobody.forEach(function (rotation) { plan.warnings.push({ rotation: rotation, message: 'group ' + name + ': nobody on call in ' + rotation }); });
    if (!g.members.length) plan.warnings.push({ rotation: null, message: 'group ' + name + ': nobody on call, left as it is' });
    plan.groups.push({ group: name, rotations: g.rotations, members: g.members.slice().sort() });
  });
  return plan;
}

// #Slack state rows as entries { rotation, preset, to, start, who, sentAt }; blank rows are skipped.
function slackStateFromRows(rows) {
  return (rows || []).filter(function (cells) { return !isBlankRow(cells); }).map(function (cells) {
    return { rotation: cellText(cells[0]), preset: cellText(cells[1]), to: cellText(cells[2]), start: cellText(cells[3]), who: cellText(cells[4]), sentAt: cellText(cells[5]) };
  });
}

// The new #Slack state rows: the entries of rotations the run read and presets the tab knows, with each
// posted message ({ rotation, preset, to, start, who, sentAt }) replacing the entry of its destination;
// sorted by rotation, preset, to.
function slackStateRows(state, posted, run, inputs) {
  var rotations = run && run.status ? run.status.rotations.map(function (r) { return r.name; }) : [];
  var presets = (inputs && inputs.presets || []).map(function (p) { return p.name; });
  var entries = (state || []).filter(function (r) { return rotations.indexOf(r.rotation) >= 0 && presets.indexOf(r.preset) >= 0; });
  (posted || []).forEach(function (m) {
    entries = entries.filter(function (r) { return !(r.rotation === m.rotation && r.preset === m.preset && r.to === m.to); });
    entries.push({ rotation: m.rotation, preset: m.preset, to: m.to, start: m.start, who: m.who, sentAt: m.sentAt });
  });
  var key = function (r) { return [r.rotation, r.preset, r.to]; };
  entries.sort(function (a, b) { var ka = key(a), kb = key(b); for (var i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1; return 0; });
  return entries.map(function (r) { return [r.rotation, r.preset, r.to, r.start, r.who, r.sentAt]; });
}

// ---- 30_status.js ----
// Slack extension: the #Status block (DESIGN 14.4). The adapter fills posted, failed and the group results;
// the pure plan knows due and skipped.
var SLACK_COUNTS = ['due', 'posted', 'skipped', 'failed'];

// Status data from a plan: one line per rotation and message preset with the counts, one per group with its
// members and an empty result until the adapter sets updated, unchanged or failed, plus the plan's errors and
// warnings. Stored under status.ext.slack by the hook.
function slackStatusData(plan) {
  return {
    lines: plan.lines.map(function (l) { return { rotation: l.rotation, preset: l.preset, due: l.due, posted: 0, skipped: l.skipped, failed: 0 }; }),
    groups: plan.groups.map(function (g) { return { group: g.group, rotations: g.rotations.slice(), members: g.members.slice(), result: '' }; }),
    errors: plan.errors.slice(),
  };
}

// Hook: rows for #Status from status.ext.slack (DESIGN 8, Extensions); nothing without it. The title row
// carries the elapsed seconds of the run when known; the slack errors are error rows.
function slack_status(status) {
  var data = status.ext && status.ext.slack;
  if (!data) return null;
  var title = ['Slack' + (data.mode ? ' (' + data.mode + ')' : '')];
  if (data.elapsed !== undefined) title.push('elapsed', data.elapsed + ' s');
  var rows = [title, ['rotation', 'preset'].concat(SLACK_COUNTS)];
  var headerRows = [0, 1];
  var errorRows = [];
  (data.lines || []).forEach(function (line) {
    rows.push([line.rotation, line.preset].concat(SLACK_COUNTS.map(function (c) { return String(line[c]); })));
  });
  var groups = data.groups || [];
  if (groups.length) {
    headerRows.push(rows.length);
    rows.push(['group', 'rotations', 'members', 'result']);
    groups.forEach(function (g) { rows.push([g.group, g.rotations.join(', '), g.members.join(', '), g.result]); });
  }
  if (data.note) rows.push(['note', data.note]);
  var errors = data.errors || [];
  if (errors.length) {
    headerRows.push(rows.length);
    rows.push(['slack errors', 'where', 'message']);
    errors.forEach(function (e) { errorRows.push(rows.length); rows.push(['', e.where, e.message]); });
  }
  return { rows: rows, headerRows: headerRows, errorRows: errorRows, warningRows: [] };
}

// ---- 50_run.js ----
// Slack extension: the run hook (DESIGN 14.4). Plans from the run and the #Slack state; delivery needs
// UrlFetchApp and a run that writes (or the hourly tick), so in Node and on a dry run the block only shows
// the plan.
function slackReadState(storage) {
  return slackStateFromRows(typeof storage.readTabRows === 'function' ? storage.readTabRows(SLACK_STATE_TAB, SLACK_STATE_HEADER) : []);
}

function slack_afterRun(result, storage, options) {
  if (options.slack === false) return;
  var plan = slackPlan(result, result.ext.slack, slackReadState(storage));
  var data = slackStatusData(plan);
  var live = typeof UrlFetchApp !== 'undefined' && options.mode !== 'dry run' && (options.write || options.slack === true);
  if (!live) data.mode = typeof UrlFetchApp === 'undefined' ? 'no slack' : 'dry run';
  data.elapsed = currentRunGuard().elapsedSeconds();
  // The extension's errors count as errors of the run and its warnings as warnings (DESIGN 6).
  data.errors.forEach(function (e) { result.errors.push('Slack ' + e.where + ': ' + e.message); });
  plan.warnings.forEach(function (w) { result.status.warnings.push({ rotation: w.rotation === null ? 'Slack' : w.rotation, start: null, message: w.message }); });
  if (!plan.lines.length && !plan.groups.length && !data.errors.length) return;
  result.status.ext = result.status.ext || {};
  result.status.ext.slack = data;
}

