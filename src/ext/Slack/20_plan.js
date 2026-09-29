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
