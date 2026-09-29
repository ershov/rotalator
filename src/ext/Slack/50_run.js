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
