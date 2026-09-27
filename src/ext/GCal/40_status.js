// GCal extension: the #Status block. The adapter fills the counts; the pure plan already knows skipped.
var GCAL_COUNTS = ['create', 'update', 'delete', 'unchanged', 'skipped'];

// Status data from a plan: one line per rotation and preset with the counts at zero except skipped, plus the
// plan's errors. Stored under status.ext.gcal by the adapter.
function gcalStatusData(plan) {
  var lines = [];
  plan.rotations.forEach(function (rot) {
    rot.presets.forEach(function (preset, i) {
      var line = { rotation: rot.rotation, preset: preset, calendar: rot.calendars[i] };
      GCAL_COUNTS.forEach(function (c) { line[c] = 0; });
      line.skipped = rot.skipped;
      lines.push(line);
    });
  });
  return { lines: lines, errors: plan.errors.slice() };
}

// Hook: rows for #Status from status.ext.gcal (DESIGN 8, Extensions); nothing without it. The title row
// carries the elapsed seconds of the run when known; the calendar errors are error rows. A stop note is a
// warning of the run (50_calendar.js) and appears in the warnings table, not here.
function gcal_status(status) {
  var data = status.ext && status.ext.gcal;
  if (!data) return null;
  var title = ['Calendar' + (data.mode ? ' (' + data.mode + ')' : '')];
  if (data.elapsed !== undefined) title.push('elapsed', data.elapsed + ' s');
  var rows = [title, ['rotation', 'preset', 'calendar'].concat(GCAL_COUNTS)];
  var headerRows = [0, 1];
  var errorRows = [];
  var warningRows = [];
  (data.lines || []).forEach(function (line) {
    rows.push([line.rotation, line.preset, line.calendar].concat(GCAL_COUNTS.map(function (c) { return String(line[c]); })));
  });
  var errors = data.errors || [];
  if (errors.length) {
    headerRows.push(rows.length);
    rows.push(['calendar errors', 'where', 'message']);
    errors.forEach(function (e) { errorRows.push(rows.length); rows.push(['', e.where, e.message]); });
  }
  return { rows: rows, headerRows: headerRows, errorRows: errorRows, warningRows: warningRows };
}
