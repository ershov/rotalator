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
// the id rows as a name to id map. An id row whose name starts with '#' is commented out (3.4): blanked,
// not cached.
function parseSlackPresets(rows) {
  var ids = {};
  var cleaned = (rows || []).map(function (cells) {
    if (!slackIsIdRow(cells)) return cells;
    if (cellText(cells[0]).charAt(0) !== '#') ids[cellText(cells[0])] = cellText(cells[2]);
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

// The candidate messages of a preset for shift i of a rotation, one per distinct rendered destination, and
// the count of destinations that rendered empty or like an earlier one; the state is not consulted here.
function slackShiftMessages(rotation, preset, shifts, i) {
  var values = slackShiftValues(rotation, shifts, i, preset.group);
  var seen = {};
  var out = { messages: [], skipped: 0 };
  preset.to.forEach(function (dest) {
    var to = slackRenderTo(dest, values);
    if (to === '' || seen[to]) { out.skipped++; return; }
    seen[to] = true;
    out.messages.push({
      rotation: rotation, preset: preset.name, to: to,
      start: formatDateTime(values.start), end: formatDateTime(values.end), who: values.who,
      text: slackRenderText(preset.text, values, null), values: values,
    });
  });
  return out;
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
      var candidates = slackShiftMessages(rot.name, preset, shifts, i);
      line.skipped += candidates.skipped;
      plan.skipped += candidates.skipped;
      candidates.messages.forEach(function (m) {
        var recorded = slackStateEntry(state, rot.name, preset.name, m.to);
        if (recorded && recorded.start === m.start && recorded.who === m.who) return;
        line.due++;
        plan.messages.push(m);
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

// ---- 40_api.js ----
// Slack extension: the Web API over UrlFetchApp and id resolution (DESIGN 14.4). Needs UrlFetchApp,
// PropertiesService and Utilities; the tests provide mocks.
var SLACK_API_URL = 'https://slack.com/api/';
var SLACK_TOKEN_PROPERTY = 'rotalator.slack.token';
var SLACK_TOKEN_HINT = 'set the bot token with Set Slack token';
var SLACK_ERROR_HINTS = {
  not_in_channel: 'invite the bot to the channel or grant chat:write.public',
  not_authed: SLACK_TOKEN_HINT,
  invalid_auth: SLACK_TOKEN_HINT,
  token_revoked: SLACK_TOKEN_HINT,
  account_inactive: SLACK_TOKEN_HINT,
  missing_scope: 'add the scope to the Slack app and reinstall it',
};

function slackToken() {
  return PropertiesService.getScriptProperties().getProperty(SLACK_TOKEN_PROPERTY);
}

// Slack accepts form-encoded parameters on every method (JSON only on some); unset parameters are left out.
function slackFormEncode(params) {
  return Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); }).join('&');
}

function slackApiError(method, error) {
  return new Error(method + ': ' + error + (SLACK_ERROR_HINTS[error] ? '; ' + SLACK_ERROR_HINTS[error] : ''));
}

// One Web API call: POST to https://slack.com/api/<method> with the bot token; the parsed body when Slack says
// ok, else throws "<method>: <error>" with a hint for the common ones. On HTTP 429 sleeps Retry-After seconds
// once and retries; a second refusal fails like any other error.
function slackApi(method, params) {
  var token = slackToken();
  if (!token) throw slackApiError(method, 'no Slack token; ' + SLACK_TOKEN_HINT);
  var request = {
    method: 'post', contentType: 'application/x-www-form-urlencoded', headers: { Authorization: 'Bearer ' + token },
    payload: slackFormEncode(params || {}), muteHttpExceptions: true,
  };
  var response = UrlFetchApp.fetch(SLACK_API_URL + method, request);
  if (response.getResponseCode() === 429) {
    var headers = response.getHeaders() || {};
    Utilities.sleep(1000 * (Number(headers['Retry-After'] || headers['retry-after']) || 1));
    response = UrlFetchApp.fetch(SLACK_API_URL + method, request);
  }
  var body = null;
  try { body = JSON.parse(response.getContentText()); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') throw slackApiError(method, 'HTTP ' + response.getResponseCode());
  if (!body.ok) throw slackApiError(method, body.error || 'unknown error');
  return body;
}

// #name to id for every channel the bot can list, all pages.
function slackChannelIds() {
  var out = {};
  var cursor = '';
  do {
    var page = slackApi('conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 1000, cursor: cursor || undefined });
    (page.channels || []).forEach(function (c) { out['#' + c.name] = c.id; });
    cursor = (page.response_metadata || {}).next_cursor || '';
  } while (cursor);
  return out;
}

// @handle to id for every user group.
function slackGroupIds() {
  var out = {};
  (slackApi('usergroups.list', {}).usergroups || []).forEach(function (g) { out['@' + g.handle] = g.id; });
  return out;
}

// Why a text did not resolve; an email that Slack does not know fails in the API call itself.
function slackUnresolvedMessage(text) {
  if (slackIsChannelName(text)) return 'channel "' + text + '" not found; use its id, or invite the bot when it is private';
  if (text.charAt(0) === '@') return 'user group "' + text + '" not found';
  return 'member "' + text + '" has no Slack id; add a row "' + text + ' | id | U..."';
}

// Id resolution with the id rows of #Slack as the cache. resolve(text) gives the Slack id of a destination,
// member or group, or null when it is unknown: bare ids as they are, #name through conversations.list,
// an email through users.lookupByEmail, @handle through usergroups.list (the listings fetched once), a bare
// member id from the cache only. Each new resolution becomes an id row, listed by rows() in lookup order.
// API failures throw.
function slackResolver(ids) {
  var cache = {};
  Object.keys(ids || {}).forEach(function (name) { cache[name] = ids[name]; });
  var rows = [];
  var listed = {};
  var lookup = function (name, fetch) {
    if (cache[name]) return cache[name];
    var id = fetch();
    if (id) { cache[name] = id; rows.push([name, SLACK_ID_TYPE, id]); }
    return id || null;
  };
  var fromList = function (kind, list) {
    return function (name) { listed[kind] = listed[kind] || list(); return listed[kind][name]; };
  };
  var channel = fromList('channels', slackChannelIds);
  var group = fromList('groups', slackGroupIds);
  return {
    resolve: function (text) {
      if (slackIsUserId(text) || slackIsChannelId(text) || slackIsGroupId(text)) return text;
      if (slackIsChannelName(text)) return lookup(text, function () { return channel(text); });
      if (slackIsEmail(text)) return lookup(text, function () { return slackApi('users.lookupByEmail', { email: text }).user.id; });
      if (text.charAt(0) === '@') return lookup(text, function () { return group(text); });
      return cache[text] || null;
    },
    rows: function () { return rows; },
  };
}

// ---- 50_run.js ----
// Slack extension: the run hook (DESIGN 14.4). Plans from the run and the #Slack state; delivery needs
// UrlFetchApp and a run that writes (or the hourly tick), so in Node and on a preview the block only shows
// the plan.
function slackReadState(storage) {
  return slackStateFromRows(typeof storage.readTabRows === 'function' ? storage.readTabRows(SLACK_STATE_TAB, SLACK_STATE_HEADER) : []);
}

// mention(kind, value) for slackRenderText: the Slack mention when the value resolves, else null.
function slackMention(resolver) {
  return function (kind, value) {
    var id = null;
    // A lookup failure leaves the id verbatim (14.2); the post itself reports the error when it matters.
    try { id = resolver.resolve(value); } catch (e) { id = null; }
    if (!id) return null;
    return kind === 'group' ? '<!subteam^' + id + '>' : '<@' + id + '>';
  };
}

// Delivers the plan and fills data; returns { posted, errors: [{ row, message }] (row the #Slack row to write
// each above), idRows }. textPrefix goes before every message (the menu's [test]).
function slackDeliver(plan, data, inputs, now, textPrefix) {
  var resolver = slackResolver(inputs.ids);
  var mention = slackMention(resolver);
  var guard = currentRunGuard();
  var posted = [];
  var errors = [];
  var done = 0;
  var stopped = null;
  var fail = function (where, message, row) {
    data.errors.push({ where: where, message: message });
    errors.push({ row: row, message: message + ' (' + where + ')' });
  };
  var stop = function () { if (stopped === null) stopped = guard.stopReason(); return stopped !== null; };
  plan.messages.forEach(function (m) {
    if (stop()) return;
    var line = data.lines.find(function (l) { return l.rotation === m.rotation && l.preset === m.preset; });
    var preset = slackPreset(inputs, m.preset);
    done++;
    try {
      var channel = resolver.resolve(m.to);
      if (!channel) throw new Error(slackUnresolvedMessage(m.to));
      slackApi('chat.postMessage', { channel: channel, text: (textPrefix || '') + slackRenderText(preset.text, m.values, mention) });
      posted.push({ rotation: m.rotation, preset: m.preset, to: m.to, start: m.start, who: m.who, sentAt: now });
      line.posted++;
    } catch (e) {
      line.failed++;
      fail(m.rotation + ' / ' + m.preset, e.message, preset.setRows.to);
    }
  });
  plan.groups.forEach(function (g) {
    if (!g.members.length || stop()) return;
    var entry = data.groups.find(function (x) { return x.group === g.group; });
    var preset = inputs.presets.find(function (p) { return p.group === g.group; });
    try {
      var id = resolver.resolve(g.group);
      if (!id) throw new Error(slackUnresolvedMessage(g.group));
      var members = [];
      g.members.forEach(function (member) {
        var uid = null, why = null;
        try { uid = resolver.resolve(member); why = uid ? null : slackUnresolvedMessage(member); } catch (e) { why = e.message; }
        if (uid) members.push(uid); else plan.warnings.push({ rotation: null, message: 'group ' + g.group + ': ' + why });
      });
      if (!members.length) { plan.warnings.push({ rotation: null, message: 'group ' + g.group + ': no member has a Slack id, left as it is' }); return; }
      members.sort();
      var current = (slackApi('usergroups.users.list', { usergroup: id }).users || []).slice().sort();
      if (current.join(',') === members.join(',')) { entry.result = 'unchanged'; return; }
      slackApi('usergroups.users.update', { usergroup: id, users: members.join(',') });
      entry.result = 'updated';
    } catch (e) {
      entry.result = 'failed';
      fail('group ' + g.group, e.message, preset.setRows.group);
    }
  });
  if (stopped !== null) data.note = stopNote(stopped, done, 'message(s)');
  return { posted: posted, errors: errors, idRows: resolver.rows() };
}

// Writes #Slack when a delivery brought new id rows or errors.
function slackWriteDelivery(storage, inputs, delivery) {
  if (!delivery.idRows.length && !delivery.errors.length) return;
  storage.writeTabRows(SLACK_TAB, PRESET_HEADER, presetRowsWithErrors(inputs.rows.concat(delivery.idRows), inputs.errors.concat(delivery.errors)));
}

// Hook (DESIGN 8, Extensions): plans, delivers when live (14.4) and records the block; slack === false skips it.
function slack_afterRun(result, storage, options) {
  if (options.slack === false) return;
  var inputs = result.ext.slack;
  var state = slackReadState(storage);
  var plan = slackPlan(result, inputs, state);
  var data = slackStatusData(plan);
  var live = typeof UrlFetchApp !== 'undefined' && options.mode !== 'preview' && (options.write || options.slack === true);
  if (live) {
    var delivery = slackDeliver(plan, data, inputs, result.status.now);
    if (delivery.posted.length) storage.writeTabRows(SLACK_STATE_TAB, SLACK_STATE_HEADER, slackStateRows(state, delivery.posted, result, inputs));
    slackWriteDelivery(storage, inputs, delivery);
  } else data.mode = typeof UrlFetchApp === 'undefined' ? 'no slack' : 'preview';
  data.elapsed = currentRunGuard().elapsedSeconds();
  if (options.write) writeSettingErrors(result, storage, plan.errors, 'slack');
  // The extension's errors count as errors of the run, its warnings and a stop note as warnings (DESIGN 6, 10.4).
  data.errors.forEach(function (e) { result.errors.push('Slack ' + e.where + ': ' + e.message); });
  plan.warnings.forEach(function (w) { result.status.warnings.push({ rotation: w.rotation === null ? 'Slack' : w.rotation, start: null, message: w.message }); });
  if (data.note) result.status.warnings.push({ rotation: 'Slack', start: null, message: data.note });
  if (!plan.lines.length && !plan.groups.length && !data.errors.length) return;
  result.status.ext = result.status.ext || {};
  result.status.ext.slack = data;
}

// ---- 60_menu.js ----
// Slack extension: menu actions, the hourly tick, Set Up and #Help lines (DESIGN 14.5). Apps Script entry
// points; they use the core's SheetsStorage, runStorage, withLock and toast.
var SLACK_TOAST_TITLE = 'Rotalator Slack';
var SLACK_COLUMN_WIDTHS = [140, 120, 700];
var SLACK_TICK_HANDLER = 'slackTick';
var SLACK_TEST_PREFIX = '[test] ';
var SLACK_TEMPLATE_TO = '#FILL-IN-WITH-CHANNEL';
var SLACK_TEMPLATE_GROUP = '@oncall';
var SLACK_TEMPLATE_HEADS_TEXT = 'Reminder: you are on call for {rotation} from {start:%a %e %b} to {end:%a %e %b}';

// Cheat sheet shared by the #Slack template (comment rows in column C) and #Help. Built on call: the default
// text lives in another file.
function slackCheatSheet() {
  return [
    'SETTINGS (one per row under a preset row: setting in B, value in C; a preset needs to or group):',
    'to: comma-separated destinations: a channel id (C..., G...) or #channel, a person by email or user id (U..., W...), or {who}, {prev}, {next}; default empty',
    'when: signed clock interval relative to the shift start: 0 at the handover, -3d three days before, 2h after, 1d12h (units d, h, m); default 0',
    'text: message template, default ' + SLACK_DEFAULT_TEXT,
    'group: a user group kept pointing at the people on call, @handle or its id S...; default empty',
    'TEMPLATES: {who} {prev} {next} {rotation} {start} {end} {note} {pin} {group}; {start:%a %e %b} with %Y %m %d %e %H %M %a %A %b %B %j %u; members and the group become mentions when their id is known',
    'IDS: rows "<name> | id | <Slack id>" cache resolved ids; the script appends them; add one by hand for a member whose id is not an email, delete one to force a new lookup',
    'USE: set slack=<preset> [<preset> ...] in a rotation or in #Global, then Run',
  ];
}

function slackHelpLines() {
  return [
    '',
    'SLACK (Slack extension, #Slack tab: preset | setting | value):',
    'preset row: name in A (letters, digits, - _), note in C; setting rows below it: setting in B, value in C',
  ].concat(slackCheatSheet().slice(1), [
    'timing: a message goes out in the first run whose instant falls in [start + when, end + when) of a shift, once per shift, destination and assignee (#Slack state remembers; delete a row there to send again); the nightly trigger delivers between 02:00 and 03:00, the hourly Slack trigger within the hour',
    'groups: a group holds the people on call now in every rotation naming a preset with it; anyone added by hand is removed at the next run; with nobody on call the group is left as it is',
    'Set Slack token... | Remove Slack token: the bot token (xoxb-...) lives in a script property, never in a cell',
    'Check Slack connection: calls auth.test and shows the workspace and the bot name',
    'Send test message: selected preset: posts the preset on the selected row of #Slack, prefixed [test], for the shift in force in the first rotation naming it, without recording it',
    'Install hourly Slack trigger | Remove hourly Slack trigger: an hourly tick that posts and updates groups without rewriting the ledgers',
  ]);
}

// Header, cheat sheet as comment rows, an empty row, then the team and heads-up presets to fill in.
function slackTemplateRows() {
  var comment = function (text) { return ['', '', text]; };
  var setting = function (key, value) { return ['', key, value]; };
  return [PRESET_HEADER.slice()].concat(slackCheatSheet().map(comment), [
    ['', '', ''],
    ['team', '', 'Channel handover message and the ' + SLACK_TEMPLATE_GROUP + ' group'],
    setting('to', SLACK_TEMPLATE_TO),
    setting('when', '0'),
    setting('text', SLACK_DEFAULT_TEXT),
    setting('group', SLACK_TEMPLATE_GROUP),
    ['heads-up', '', 'Reminder to the person three days before'],
    setting('to', '{who}'),
    setting('when', '-3d'),
    setting('text', SLACK_TEMPLATE_HEADS_TEXT),
  ]);
}

// Row colours like #GCal (13.5) plus id rows light grey; the id rule comes before the preset rule since both
// match a non-empty column A.
function slackFormatRules() {
  return [
    { formula: '=$B1="' + PRESET_ERROR_TYPE + '"', color: COLOR_ERROR },
    { formula: '=LOWER($B1)="' + SLACK_ID_TYPE + '"', color: COLOR_DETACH },
    { formula: PRESET_DISABLED_BLOCK_FORMULA, color: COLOR_COMMENT },
    { formula: PRESET_DISABLED_ROW_FORMULA, color: COLOR_COMMENT },
    { formula: '=AND($A1<>"", ROW()>1)', color: COLOR_SETTINGS },
    { formula: PRESET_COMMENT_FORMULA, color: COLOR_COMMENT },
  ];
}

function slack_menu(menu) {
  menu.addSeparator()
    .addItem('Set Slack token…', 'slackSetToken')
    .addItem('Remove Slack token', 'slackRemoveToken')
    .addItem('Check Slack connection', 'slackCheckConnection')
    .addItem('Send test message: selected preset', 'slackSendTest')
    .addItem('Install hourly Slack trigger', 'slackInstallTrigger')
    .addItem('Remove hourly Slack trigger', 'slackRemoveTrigger');
}

function slack_help(lines) {
  return slackHelpLines();
}

// #Slack is formatted as a preset tab (core formatPresetTab) with its widths and row colours.
function slackFormatTab(sheet) {
  formatPresetTab(sheet, SLACK_COLUMN_WIDTHS, slackFormatRules());
}

// The tab #Slack follows: #GCal when present, else #Global.
function slackAnchorTab(ss) {
  return ss.getSheetByName(GCAL_TAB) || ss.getSheetByName(GLOBAL_TAB);
}

// Hook: creates #Slack after #GCal or #Global with the template when missing or empty, places and formats it;
// an existing #Slack state gets the colour of the script-written tabs.
function slack_setup(ss) {
  var sheet = ss.getSheetByName(SLACK_TAB);
  if (!sheet) {
    var anchor = slackAnchorTab(ss);
    sheet = ss.insertSheet(SLACK_TAB, anchor ? anchor.getIndex() : ss.getNumSheets());
  }
  if (isEmptySheet(sheet)) writeTextCells(sheet, 1, slackTemplateRows());
  placeTabAfter(ss, sheet, slackAnchorTab(ss));
  slackFormatTab(sheet);
  var state = ss.getSheetByName(SLACK_STATE_TAB);
  if (state) state.setTabColor(TAB_COLOR_GENERATED);
  return sheet;
}

// Hook: Set Up Tab on #Slack fills an empty tab from the template; any other tab is left to the core.
function slack_setupTab(sheet) {
  if (sheet.getName() !== SLACK_TAB) return false;
  if (!isEmptySheet(sheet)) { toast('"' + SLACK_TAB + '" is not empty; Set Up Tab only fills empty tabs', SLACK_TOAST_TITLE); return true; }
  writeTextCells(sheet, 1, slackTemplateRows());
  slackFormatTab(sheet);
  toast('"' + SLACK_TAB + '" set up from the template; fill in the channel of team', SLACK_TOAST_TITLE);
  return true;
}

// Menu: Set Slack token. The token goes into a script property and is never shown or written to a cell.
function slackSetToken() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('Slack bot token', 'Paste the bot token (xoxb-...). It is stored in a script property, never in a cell.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return false;
  var token = response.getResponseText().trim();
  if (token === '') { toast('no token entered; nothing changed', SLACK_TOAST_TITLE); return false; }
  PropertiesService.getScriptProperties().setProperty(SLACK_TOKEN_PROPERTY, token);
  toast('Slack token stored', SLACK_TOAST_TITLE);
  return true;
}

function slackRemoveToken() {
  PropertiesService.getScriptProperties().deleteProperty(SLACK_TOKEN_PROPERTY);
  toast('Slack token removed', SLACK_TOAST_TITLE);
}

// Menu: Check Slack connection. auth.test names the workspace and the bot.
function slackCheckConnection() {
  return withLock(function () {
    try {
      var info = slackApi('auth.test', {});
      toast('connected to ' + info.team + ' as ' + info.user, SLACK_TOAST_TITLE);
      return info;
    } catch (e) {
      toast(e.message, SLACK_TOAST_TITLE);
      return null;
    }
  });
}

// The active cell's row in #Slack names the preset; a setting or id row counts for the preset above it.
function slackSelectedPreset(sheet) {
  if (sheet.getName() !== SLACK_TAB) return null;
  var row = sheet.getActiveRange().getRow();
  var cells = sheet.getRange(1, 1, Math.max(row, 1), 2).getValues();
  while (row > 1 && (cellText(cells[row - 1][0]) === '' || slackIsIdRow(cells[row - 1]))) row--;
  return row > 1 ? cellText(cells[row - 1][0]) : null;
}

// The test messages of a preset, pure: its destinations rendered for the shift in force at now in the first
// rotation whose slack names it. Returns { rotation, messages, error }; messages as in slackPlan.
function slackTestPlan(run, inputs, name) {
  var preset = slackPreset(inputs, name);
  if (!preset) return { rotation: null, messages: [], error: 'unknown preset "' + name + '"' };
  if (preset.errors.length) return { rotation: null, messages: [], error: 'preset "' + name + '" has errors: ' + preset.errors.join('; ') };
  if (!preset.to.length) return { rotation: null, messages: [], error: 'preset "' + name + '" has no to' };
  var rot = run.status.rotations.find(function (r) {
    var setting = r.settings.values.find(function (s) { return s.key === 'slack'; });
    return setting && setting.value.split(' ').indexOf(name) >= 0;
  });
  if (!rot) return { rotation: null, messages: [], error: 'no rotation names preset "' + name + '" in slack' };
  var shifts = slackRotationShifts(run, rot.name);
  var now = run.status.at;
  var i = shifts.findIndex(function (s) { return s.start <= now && now < s.end; });
  if (i < 0 || shifts[i].who === '') return { rotation: rot.name, messages: [], error: 'nobody on call in ' + rot.name + ' now' };
  return { rotation: rot.name, messages: slackShiftMessages(rot.name, preset, shifts, i).messages, error: null };
}

// Menu: Send test message. Runs the scheduler without writing, posts the selected preset's messages with the
// [test] prefix through the adapter (id rows and error rows reach #Slack), and leaves #Slack state alone.
function slackSendTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = slackSelectedPreset(ss.getActiveSheet());
  if (name === null) { toast('select a preset row in ' + SLACK_TAB, SLACK_TOAST_TITLE); return null; }
  return withLock(function () {
    var storage = new SheetsStorage(ss);
    var result = runStorage(storage, storage.nowText, { write: false, export: false, slack: false });
    if (result.errors.length) { toast(result.errors.length + ' error(s), nothing sent: ' + result.errors[0], SLACK_TOAST_TITLE); return null; }
    var test = slackTestPlan(result, result.ext.slack, name);
    if (test.error) { toast(test.error, SLACK_TOAST_TITLE); return null; }
    var plan = { lines: [{ rotation: test.rotation, preset: name, due: test.messages.length, skipped: 0 }], messages: test.messages, groups: [], errors: [], warnings: [] };
    var data = slackStatusData(plan);
    var delivery = slackDeliver(plan, data, result.ext.slack, result.status.now, SLACK_TEST_PREFIX);
    slackWriteDelivery(storage, result.ext.slack, delivery);
    data.errors.forEach(function (e) { console.log('error: Slack ' + e.where + ': ' + e.message); });
    if (data.note) console.log('warning: Slack: ' + data.note);
    toast('test message of ' + name + ' for ' + test.rotation + ': ' + delivery.posted.length + ' sent, ' + data.errors.length + ' failed' + (data.errors.length ? ': ' + data.errors[0].message : ''), SLACK_TOAST_TITLE);
    return data;
  });
}

// Options of the hourly tick: nothing written by the core, no calendar export, Slack delivery on (14.5).
var SLACK_TICK_OPTIONS = { write: false, export: false, slack: true };

// Trigger handler: posts and updates groups from a read of all rotations, under the lock like Run.
function slackTick() {
  return withLock(function () {
    var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
    var result = runStorage(storage, storage.nowText, SLACK_TICK_OPTIONS);
    runLogLines(result).forEach(function (line) { console.log(line); });
    return result;
  });
}

function slackDeleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === SLACK_TICK_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function slackInstallTrigger() {
  slackDeleteTriggers();
  ScriptApp.newTrigger(SLACK_TICK_HANDLER).timeBased().everyHours(1).create();
  toast('hourly Slack trigger installed', SLACK_TOAST_TITLE);
}

function slackRemoveTrigger() {
  slackDeleteTriggers();
  toast('hourly Slack trigger removed', SLACK_TOAST_TITLE);
}

