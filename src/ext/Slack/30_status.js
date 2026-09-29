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
