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
