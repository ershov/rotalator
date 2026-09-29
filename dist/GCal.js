// ---- 10_presets.js ----
// GCal extension: calendar presets from the #GCal tab or gcal.csv (DESIGN 13.1). The tab grammar is the
// core's parsePresetTab (72_presets.js); this file supplies GCal's settings table and the value parsers.
// Everything of the extension is prefixed gcal.
var GCAL_DEFAULT_TITLE = '{rotation}: {who}';
var GCAL_DEFAULT_BODY = 'Rotalator shift {rotation} {start} to {end}. {note}';
// CalendarApp.EventColor names and their numbers, and the palette of the Calendar UI as hex RGB.
var GCAL_COLORS = { PALE_BLUE: 1, PALE_GREEN: 2, MAUVE: 3, PALE_RED: 4, YELLOW: 5, ORANGE: 6, CYAN: 7, GRAY: 8, BLUE: 9, GREEN: 10, RED: 11 };
var GCAL_COLOR_RGB = {
  PALE_BLUE: 'a4bdfc', PALE_GREEN: '7ae7bf', MAUVE: 'dbadff', PALE_RED: 'ff887c', YELLOW: 'fbd75b', ORANGE: 'ffb878',
  CYAN: '46d6db', GRAY: 'e1e1e1', BLUE: '5484ed', GREEN: '51b749', RED: 'dc2127',
};
var GCAL_COLOR_DEFAULT = 'default';
var GCAL_COLOR_HINT = 'default (the calendar\'s own colour), a Calendar colour name like pale blue, its number 1 to 11, or #RRGGBB (the nearest colour is used)';

function gcalParseText(text) {
  return text === '' ? null : text;
}

function gcalRgb(hex) {
  return [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
}

// The event colour nearest to #RRGGBB by RGB distance, ties to the lowest number.
function gcalNearestColor(hex) {
  var rgb = gcalRgb(hex);
  var best = null, bestDistance = Infinity;
  Object.keys(GCAL_COLORS).forEach(function (name) {
    var c = gcalRgb(GCAL_COLOR_RGB[name]);
    var d = c.reduce(function (sum, v, i) { return sum + (v - rgb[i]) * (v - rgb[i]); }, 0);
    if (d < bestDistance || (d === bestDistance && GCAL_COLORS[name] < best)) { best = GCAL_COLORS[name]; bestDistance = d; }
  });
  return best;
}

// default (or none): the calendar's own colour, left alone on the events; else a colour name (spaces, dashes
// or underscores), a number 1 to 11, or #RRGGBB mapped to the nearest colour.
function gcalParseColor(text) {
  var lower = text.toLowerCase();
  if (lower === GCAL_COLOR_DEFAULT || lower === 'none') return GCAL_COLOR_DEFAULT;
  var n = parseInteger(text);
  if (n !== null) return n >= 1 && n <= 11 ? n : null;
  if (/^#[0-9a-f]{6}$/i.test(text)) return gcalNearestColor(text.slice(1).toLowerCase());
  return GCAL_COLORS[text.toUpperCase().replace(/[\s-]+/g, '_')] || null;
}

// auto, true or false: 'auto' or a boolean.
function gcalParseAllday(text) {
  if (text.toLowerCase() === 'auto') return 'auto';
  return parseBoolean(text);
}

// Comma-separated clock intervals before the start, as minutes.
function gcalParseReminders(text) {
  var out = [];
  var items = splitList(text);
  for (var i = 0; i < items.length; i++) {
    var interval = parseInterval(items[i]);
    if (interval === null || interval.unit !== 'clock') return null;
    out.push(interval.minutes);
  }
  return out;
}

// parse returns null on a bad value; def is the value of an unset setting; template settings are checked
// for unknown placeholders and directives once, at parse time; id is required (core parsePresetTab).
var GCAL_SETTINGS = {
  id:        { parse: gcalParseText,      def: null,               hint: 'a calendar id', required: true },
  title:     { parse: gcalParseText,      def: GCAL_DEFAULT_TITLE, template: true },
  body:      { parse: gcalParseText,      def: GCAL_DEFAULT_BODY,  template: true },
  allday:    { parse: gcalParseAllday,    def: 'auto',             hint: 'auto, true or false' },
  color:     { parse: gcalParseColor,     def: GCAL_COLOR_DEFAULT, hint: GCAL_COLOR_HINT },
  free:      { parse: parseBoolean,       def: true,               hint: 'true or false' },
  invite:    { parse: parseBoolean,       def: true,               hint: 'true or false' },
  reminders: { parse: gcalParseReminders, def: [],                 hint: 'comma-separated clock intervals like 1d, 2h, 30m, or empty for the calendar defaults' },
};

// The core's preset grammar (DESIGN 13.1) with GCal's settings and placeholders: every preset in tab order
// with its own errors and setRows, and the flat errors { row, where: '#GCal row N', message }.
function parseGCalPresets(rows) {
  return parsePresetTab(rows, GCAL_SETTINGS, { tab: GCAL_TAB, placeholders: GCAL_PLACEHOLDERS });
}

function gcalDropErrorRows(rows) {
  return dropPresetErrorRows(rows);
}

function gcalRowsWithErrors(rows, errors) {
  return presetRowsWithErrors(rows, errors);
}

function gcalPreset(inputs, name) {
  return (inputs && inputs.presets || []).find(function (p) { return p.name === name; }) || null;
}

// Hook: the extension's inputs, read through the storage before the run (DESIGN 8, Extensions). Error rows
// of the previous run are dropped first; when the presets have errors, or error rows were dropped, the tab
// is written back with an error row above each offending row (13.1), through writeTabRows when the storage
// has it. A storage that only reads gets no write.
function gcal_readInputs(storage) {
  var read = typeof storage.readTabRows === 'function' ? storage.readTabRows(GCAL_TAB, PRESET_HEADER) : [];
  var rows = gcalDropErrorRows(read);
  var inputs = parseGCalPresets(rows);
  inputs.rows = rows;
  if (typeof storage.writeTabRows === 'function') {
    var written = gcalRowsWithErrors(rows, inputs.errors);
    if (JSON.stringify(written) !== JSON.stringify(gcalRowsWithErrors(read, []))) storage.writeTabRows(GCAL_TAB, PRESET_HEADER, written);
  }
  return inputs;
}

// ---- 20_format.js ----
// GCal extension: event titles and bodies from templates, through the core's formatTemplate (DESIGN 13.2).
// Placeholders {who} {rotation} {note} {pin} {start} {end}; {start} and {end} take an optional strftime
// format, {start:%a %d %b}. Unknown placeholders and directives stay verbatim and are reported.
var GCAL_PLACEHOLDERS = ['who', 'rotation', 'note', 'pin', 'start', 'end'];

// values: { who, rotation, note, pin, start, end } with start and end as minutes; a placeholder the caller
// leaves out renders empty. Returns { text, unknown }.
function gcalFormat(template, values) {
  var full = {};
  GCAL_PLACEHOLDERS.forEach(function (name) { full[name] = values[name]; });
  return formatTemplate(template, full);
}

function gcalTemplateErrors(template, field) {
  return templateErrors(template, field, GCAL_PLACEHOLDERS);
}

// ---- 30_plan.js ----
// GCal extension: the export plan, pure. Desired events per rotation and preset from the runner's result and
// the parsed presets; the CalendarApp adapter reconciles the calendar against it.
var GCAL_TAG = 'rotalator';
// Bound of a whole-calendar clean and of the nightly deletions around now (13.4).
var GCAL_CLEAN_YEARS_BACK = 1;
var GCAL_CLEAN_YEARS_AHEAD = 3;

// Window of a whole-calendar clean; its end also bounds the stale events the reconcile deletes.
function gcalCleanWindow(now) {
  return {
    from: formatDateTime(now - GCAL_CLEAN_YEARS_BACK * 365 * MINUTES_PER_DAY),
    to: formatDateTime(now + GCAL_CLEAN_YEARS_AHEAD * 365 * MINUTES_PER_DAY),
  };
}

// Event key, the tag value on the calendar event: rotation|start in the sheet's datetime form.
function gcalEventKey(rotation, start) {
  return rotation + '|' + formatDateTime(start);
}

// Shifts of a written rotation: start, end and assignee from the status (the swept extents), pin and note
// from the written rows. who is '' for a nobody shift.
function gcalRotationShifts(run, name) {
  var byStart = {};
  rowsFromCells(run.ledgers[name] || []).forEach(function (r) { if (r.type === 'shift' && r.start !== null) byStart[r.start] = r; });
  return run.status.shifts.filter(function (s) { return s.rotation === name; }).map(function (s) {
    var row = byStart[s.start];
    return { start: s.start, end: s.end, who: s.who, pin: row ? row.pin : '', note: row ? row.note : '' };
  });
}

// Presets named by the rotation's cal value, in order; unknown names, presets with errors and a second preset
// on the same calendar (its events would share the first one's keys) are reported and skipped. Errors that
// the cal value itself causes carry setting: 'cal' so they can be written above the set row (DESIGN 6); a
// preset skipped for its own errors is already reported in #GCal.
function gcalRotationPresets(cal, inputs, rotation, errors) {
  var out = [];
  var calendars = {};
  var atCal = function (message) { errors.push({ where: rotation, rotation: rotation, setting: 'cal', message: message }); };
  (cal === '' ? [] : cal.split(' ')).forEach(function (name) {
    var preset = gcalPreset(inputs, name);
    if (!preset) atCal('unknown preset "' + name + '" in cal; add it to ' + GCAL_TAB);
    else if (preset.errors.length) errors.push({ where: rotation, rotation: rotation, message: 'preset "' + name + '" skipped: ' + preset.errors.join('; ') });
    else if (calendars[preset.id]) atCal('preset "' + name + '" skipped: calendar ' + preset.id + ' is already used by preset "' + calendars[preset.id] + '"');
    else { calendars[preset.id] = name; out.push(preset); }
  });
  return out;
}

// Export window [from, to): from the stored snapshot the run started at (everything after it may have
// changed) to horizonEnd; without a stored snapshot, or when repairing, from the rotation's first shift.
function gcalWindow(rot, shifts, repair) {
  var first = shifts.length ? shifts[0].start : rot.snapshotAt;
  var from = repair || rot.previousAt === null || rot.previousAt === undefined ? first : rot.previousAt;
  return { from: from, to: rot.horizonEnd };
}

// Title and body are trimmed, so an empty {note} at the end of the default body leaves no trailing space.
function gcalEvent(rotation, preset, shift) {
  var values = { who: shift.who, rotation: rotation, note: shift.note, pin: shift.pin, start: shift.start, end: shift.end };
  var midnight = shift.start % MINUTES_PER_DAY === 0 && shift.end % MINUTES_PER_DAY === 0;
  return {
    key: gcalEventKey(rotation, shift.start),
    rotation: rotation,
    preset: preset.name,
    calendar: preset.id,
    title: gcalFormat(preset.title, values).text.trim(),
    body: gcalFormat(preset.body, values).text.trim(),
    start: formatDateTime(shift.start),
    end: formatDateTime(shift.end),
    allDay: preset.allday === 'auto' ? midnight : preset.allday,
    color: preset.color === GCAL_COLOR_DEFAULT ? null : preset.color,
    free: preset.free,
    guests: preset.invite && shift.who.indexOf('@') >= 0 ? [shift.who] : [],
    reminders: preset.reminders.slice(),
  };
}

// run: the runner's result (DESIGN 8) after a run without errors; inputs: parseGCalPresets output.
// options: repair (window from the first shift), rotations (names; default every written rotation).
// Returns { rotations: [{ rotation, presets, calendars, from, to, until, shifts, skipped }], events, errors };
// events in rotation, start, preset order; skipped counts the nobody shifts inside the window; until is the
// later of to and the clean bound after now, up to which the adapter deletes the rotation's stale events.
function gcalPlan(run, inputs, options) {
  options = options || {};
  var plan = { rotations: [], events: [], errors: (inputs && inputs.errors || []).slice() };
  if (!run || !run.status) return plan;
  var names = options.rotations || Object.keys(run.ledgers);
  run.status.rotations.forEach(function (rot) {
    if (names.indexOf(rot.name) < 0 || !(rot.name in run.ledgers)) return;
    var cal = rot.settings.values.find(function (s) { return s.key === 'cal'; });
    var presets = gcalRotationPresets(cal ? cal.value : '', inputs, rot.name, plan.errors);
    if (!presets.length) return;
    var shifts = gcalRotationShifts(run, rot.name);
    var window = gcalWindow(rot, shifts, options.repair);
    var inside = shifts.filter(function (s) { return s.start >= window.from && s.start < window.to; });
    var wanted = inside.filter(function (s) { return s.who !== ''; });
    var until = Math.max(window.to, gcalCleanBound(run.status.at, window.to));
    plan.rotations.push({
      rotation: rot.name,
      presets: presets.map(function (p) { return p.name; }),
      calendars: presets.map(function (p) { return p.id; }),
      from: formatDateTime(window.from),
      to: formatDateTime(window.to),
      until: formatDateTime(until),
      shifts: wanted.length,
      skipped: inside.length - wanted.length,
    });
    wanted.forEach(function (shift) {
      presets.forEach(function (preset) { plan.events.push(gcalEvent(rot.name, preset, shift)); });
    });
  });
  return plan;
}

// The clean bound after now in minutes; fallback when now is unknown.
function gcalCleanBound(now, fallback) {
  return now === null || now === undefined ? fallback : parseDateTime(gcalCleanWindow(now).to);
}

// Clean plan: { rotation, calendars, from, to, keys } for a rotation (the adapter deletes its tagged events in
// [from, to), which reaches the clean bound so stale events beyond the horizon go too), or { calendar, all:
// true } for a preset (every tagged event). A missing preset or one with errors gives { error }.
function gcalCleanPlan(run, inputs, target) {
  if (target.preset !== undefined) {
    var preset = gcalPreset(inputs, target.preset);
    if (!preset) return { error: 'unknown preset "' + target.preset + '"' };
    if (preset.errors.length) return { error: 'preset "' + preset.name + '" has errors: ' + preset.errors.join('; ') };
    return { preset: preset.name, calendar: preset.id, all: true };
  }
  var rot = run && run.status ? run.status.rotations.find(function (r) { return r.name === target.rotation; }) : null;
  if (!rot) return { error: 'unknown rotation "' + target.rotation + '"' };
  var errors = [];
  var cal = rot.settings.values.find(function (s) { return s.key === 'cal'; });
  var presets = gcalRotationPresets(cal ? cal.value : '', inputs, rot.name, errors);
  var shifts = gcalRotationShifts(run, rot.name);
  var last = shifts.reduce(function (max, s) { return Math.max(max, s.end); }, gcalCleanBound(run.status.at, rot.horizonEnd));
  return {
    rotation: rot.name,
    calendars: presets.map(function (p) { return p.id; }),
    from: shifts.length ? formatDateTime(shifts[0].start) : formatDateTime(rot.snapshotAt),
    to: formatDateTime(last),
    keys: shifts.map(function (s) { return gcalEventKey(rot.name, s.start); }),
    errors: errors,
  };
}

// ---- 40_status.js ----
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

// ---- 50_calendar.js ----
// GCal extension: the CalendarApp adapter (DESIGN 13.4). Plumbing around the pure plan: reconcile a calendar
// against the desired events, delete tagged events for a clean, and the gcal_afterRun hook. Needs CalendarApp
// and Utilities; the tests provide mocks.
var GCAL_DATETIME_PATTERN = "yyyy-MM-dd'T'HH:mm";

// Timed instants are converted in the spreadsheet time zone; all-day dates in the script time zone, which is
// what createAllDayEvent, setAllDayDates, getAllDayStartDate and getAllDayEndDate work in, so the result does
// not depend on the two zones matching.
function gcalScriptTimeZone(tz) {
  return typeof Session !== 'undefined' ? Session.getScriptTimeZone() : tz;
}

// Sheet datetime text (naive) to a Date and back to the canonical text.
function gcalToDate(text, tz, allDay) {
  var zone = allDay ? gcalScriptTimeZone(tz) : tz;
  return Utilities.parseDate(text.indexOf('T') < 0 ? text + 'T00:00' : text, zone, GCAL_DATETIME_PATTERN);
}

function gcalFromDate(date, tz, allDay) {
  var zone = allDay ? gcalScriptTimeZone(tz) : tz;
  return formatDateTime(parseDateTime(Utilities.formatDate(date, zone, GCAL_DATETIME_PATTERN)));
}

function gcalGuests(list) {
  return gcalSorted(list.map(function (g) { return g.toLowerCase(); }));
}

function gcalColorValue(n) {
  var name = Object.keys(GCAL_COLORS).find(function (k) { return GCAL_COLORS[k] === n; });
  return CalendarApp.EventColor[name];
}

function gcalTransparency(free) {
  return free ? CalendarApp.EventTransparency.TRANSPARENT : CalendarApp.EventTransparency.OPAQUE;
}

function gcalSorted(list) {
  return list.slice().sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
}

function gcalSameList(a, b) {
  return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
}

// The state of an existing event in plan terms. Guest emails are compared lower-cased, as Calendar returns
// them.
function gcalEventState(ev, tz) {
  var allDay = ev.isAllDayEvent();
  return {
    title: ev.getTitle(),
    body: ev.getDescription(),
    start: gcalFromDate(allDay ? ev.getAllDayStartDate() : ev.getStartTime(), tz, allDay),
    end: gcalFromDate(allDay ? ev.getAllDayEndDate() : ev.getEndTime(), tz, allDay),
    allDay: allDay,
    color: ev.getColor() || '',
    free: ev.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT,
    guests: gcalGuests(ev.getGuestList().map(function (g) { return g.getEmail(); })),
    reminders: gcalSorted(ev.getPopupReminders()),
  };
}

// Fields of an existing event that differ from the desired one. A preset without color leaves the colour
// alone, and one without reminders leaves the event's reminders alone (the calendar defaults apply).
function gcalDiff(state, want) {
  var diff = [];
  if (state.title !== want.title) diff.push('title');
  if (state.body !== want.body) diff.push('body');
  if (state.allDay !== want.allDay || state.start !== want.start || state.end !== want.end) diff.push('time');
  if (want.color !== null && state.color !== String(want.color)) diff.push('color');
  if (state.free !== want.free) diff.push('free');
  if (!gcalSameList(state.guests, gcalGuests(want.guests))) diff.push('guests');
  if (want.reminders.length && !gcalSameList(state.reminders, gcalSorted(want.reminders))) diff.push('reminders');
  return diff;
}

// All-day end dates are exclusive, like the plan's end.
function gcalApplyTime(ev, want, tz) {
  var start = gcalToDate(want.start, tz, want.allDay), end = gcalToDate(want.end, tz, want.allDay);
  if (want.allDay) ev.setAllDayDates(start, end);
  else ev.setTime(start, end);
}

// A non-empty list is applied exactly; an empty one is never applied, so a new event keeps the calendar's
// default reminders and an existing one keeps whatever it has.
function gcalApplyReminders(ev, want) {
  if (!want.reminders.length) return;
  ev.removeAllReminders();
  want.reminders.forEach(function (m) { ev.addPopupReminder(m); });
}

// Invitations go out on creation only.
function gcalCreate(calendar, want, tz) {
  var options = { description: want.body };
  if (want.guests.length) { options.guests = want.guests.join(','); options.sendInvites = true; }
  var start = gcalToDate(want.start, tz, want.allDay), end = gcalToDate(want.end, tz, want.allDay);
  var ev = want.allDay ? calendar.createAllDayEvent(want.title, start, end, options) : calendar.createEvent(want.title, start, end, options);
  ev.setTag(GCAL_TAG, want.key);
  if (want.color !== null) ev.setColor(gcalColorValue(want.color));
  ev.setTransparency(gcalTransparency(want.free));
  gcalApplyReminders(ev, want);
  return ev;
}

function gcalUpdate(ev, state, want, diff, tz) {
  if (diff.indexOf('title') >= 0) ev.setTitle(want.title);
  if (diff.indexOf('body') >= 0) ev.setDescription(want.body);
  if (diff.indexOf('time') >= 0) gcalApplyTime(ev, want, tz);
  if (diff.indexOf('color') >= 0) ev.setColor(gcalColorValue(want.color));
  if (diff.indexOf('free') >= 0) ev.setTransparency(gcalTransparency(want.free));
  if (diff.indexOf('guests') >= 0) {
    var wanted = gcalGuests(want.guests);
    wanted.forEach(function (g) { if (state.guests.indexOf(g) < 0) ev.addGuest(g); });
    state.guests.forEach(function (g) { if (wanted.indexOf(g) < 0) ev.removeGuest(g); });
  }
  if (diff.indexOf('reminders') >= 0) gcalApplyReminders(ev, want);
}

// Events of the rotation in [from, to): tagged rotalator=<rotation>|<start> with start at or after from.
// Untagged events, other rotations' events and events of shifts before the window are never touched.
function gcalTaggedEvents(calendar, rotation, from, to, tz) {
  var prefix = rotation + '|';
  var fromMin = parseDateTime(from);
  return calendar.getEvents(gcalToDate(from, tz), gcalToDate(to, tz))
    .map(function (ev) { return { key: ev.getTag(GCAL_TAG), event: ev }; })
    .filter(function (t) { return t.key && t.key.indexOf(prefix) === 0 && parseDateTime(t.key.slice(prefix.length)) >= fromMin; });
}

// Asks the run guard between steps and remembers the first reason, so every later call says stop too.
function gcalStopper(guard) {
  var reason = null;
  return {
    stop: function () { if (reason === null) reason = guard.stopReason(); return reason !== null; },
    reason: function () { return reason; },
  };
}

// Records an early stop (stopped, note after `done` steps of `what`) and the elapsed seconds on a result.
function gcalFinish(out, stopper, done, what, guard) {
  if (stopper.reason() !== null) { out.stopped = stopper.reason(); out.note = stopNote(out.stopped, done, what); }
  out.elapsed = guard.elapsedSeconds();
  return out;
}

// Reconciles every calendar of the plan and fills the counts of data (gcalStatusData). options: tz; dry to
// compute the counts without writing; guard (default the run's, DESIGN 10.4), asked between events whether
// to stop, in which case the remaining events and calendars are left for the next run and data.note says
// why; progress(line), called when a calendar is done; ticker(), called per calendar for a step function
// that receives { calendar, done, total, what, elapsed } at loop start and after each event (the adapter's
// throttled toast, 10.4). Creates and updates stay inside [from, to); the
// rotation's tagged events are fetched up to `until` (the clean bound after now), so events left beyond a
// shortened horizon are deleted too. A missing calendar or an API failure is recorded in data.errors and the
// other calendars proceed. Duplicate events with one key are deleted down to one.
function gcalReconcile(plan, data, options) {
  var tz = options.tz;
  var dry = Boolean(options.dry);
  var guard = options.guard || currentRunGuard();
  var progress = options.progress || function () {};
  var ticker = options.ticker || function () { return function () {}; };
  var done = 0;
  var stopper = gcalStopper(guard);
  var stop = stopper.stop;
  plan.rotations.forEach(function (rot) {
    rot.presets.forEach(function (preset, i) {
      if (stop()) return;
      var id = rot.calendars[i];
      var line = data.lines.find(function (l) { return l.rotation === rot.rotation && l.preset === preset; });
      var wanted = plan.events.filter(function (e) { return e.rotation === rot.rotation && e.preset === preset; });
      try {
        var calendar = CalendarApp.getCalendarById(id);
        if (!calendar) throw new Error('calendar "' + id + '" not found or not shared with this account');
        var existing = {};
        var duplicates = [];
        gcalTaggedEvents(calendar, rot.rotation, rot.from, rot.until || rot.to, tz).forEach(function (t) {
          if (existing[t.key]) duplicates.push(t.event); else existing[t.key] = t.event;
        });
        var wantedKeys = {};
        wanted.forEach(function (want) { wantedKeys[want.key] = true; });
        var staleCount = Object.keys(existing).filter(function (key) { return !wantedKeys[key]; }).length + duplicates.length;
        var step = ticker();
        var here = 0;
        var tick = function () { step({ calendar: id, done: here, total: wanted.length + staleCount, what: 'events', elapsed: guard.elapsedSeconds() }); };
        tick();
        for (var w = 0; w < wanted.length && !stop(); w++) {
          var want = wanted[w];
          var ev = existing[want.key];
          delete existing[want.key];
          done++;
          here++;
          if (!ev) { if (!dry) gcalCreate(calendar, want, tz); line.create++; tick(); continue; }
          var state = gcalEventState(ev, tz);
          var diff = gcalDiff(state, want);
          if (diff.length) { if (!dry) gcalUpdate(ev, state, want, diff, tz); line.update++; } else line.unchanged++;
          tick();
        }
        var stale = Object.keys(existing).map(function (key) { return existing[key]; }).concat(duplicates);
        for (var s = 0; s < stale.length && !stop(); s++) {
          done++;
          here++;
          if (!dry) stale[s].deleteEvent();
          line.delete++;
          tick();
        }
        if (stopper.reason() === null) progress(line);
      } catch (e) {
        data.errors.push({ where: rot.rotation + ' / ' + preset, rotation: rot.rotation, preset: preset, message: e && e.message ? e.message : String(e) });
      }
    });
  });
  return gcalFinish(data, stopper, done, 'event(s)', guard);
}

// In-place error rows for calendars that could not be opened or failed (DESIGN 13.4): above the preset's id
// row in #GCal (the preset row when it has none), on top of the parse errors already there, wherever the
// storage can write.
function gcalWriteCalendarErrors(storage, inputs, data) {
  if (typeof storage.writeTabRows !== 'function' || !inputs || !inputs.rows) return;
  var extra = [];
  data.errors.forEach(function (e) {
    var preset = e.preset ? gcalPreset(inputs, e.preset) : null;
    if (preset) extra.push({ row: preset.setRows.id || preset.row, message: e.message + ' (' + e.where + ')' });
  });
  if (extra.length) storage.writeTabRows(GCAL_TAB, PRESET_HEADER, gcalRowsWithErrors(inputs.rows, inputs.errors.concat(extra)));
}

// Deletes tagged events per a clean plan (gcalCleanPlan): a rotation's events (tag prefix rotation|) in its
// window in each of its calendars, or every tagged event of one calendar between options.from and options.to.
// options.guard (default the run's) is asked between deletions; options.ticker as in gcalReconcile, with
// what 'deletions'. Returns { deleted, errors, note, elapsed }.
function gcalClean(clean, options) {
  var out = { deleted: 0, errors: [] };
  var guard = options.guard || currentRunGuard();
  var ticker = options.ticker || function () { return function () {}; };
  var stopper = gcalStopper(guard);
  var stop = stopper.stop;
  var targets = clean.all
    ? [{ calendar: clean.calendar, prefix: '', from: options.from, to: options.to }]
    : clean.calendars.map(function (id) { return { calendar: id, prefix: clean.rotation + '|', from: clean.from, to: clean.to }; });
  targets.forEach(function (t) {
    if (stop()) return;
    try {
      var calendar = CalendarApp.getCalendarById(t.calendar);
      if (!calendar) throw new Error('calendar "' + t.calendar + '" not found or not shared with this account');
      var events = calendar.getEvents(gcalToDate(t.from, options.tz), gcalToDate(t.to, options.tz)).filter(function (ev) {
        var key = ev.getTag(GCAL_TAG);
        return key && key.indexOf(t.prefix) === 0;
      });
      var step = ticker();
      var here = 0;
      var tick = function () { step({ calendar: t.calendar, done: here, total: events.length, what: 'deletions', elapsed: guard.elapsedSeconds() }); };
      tick();
      for (var i = 0; i < events.length && !stop(); i++) {
        if (!options.dry) events[i].deleteEvent();
        out.deleted++;
        here++;
        tick();
      }
    } catch (e) {
      out.errors.push({ where: t.calendar, message: e && e.message ? e.message : String(e) });
    }
  });
  return gcalFinish(out, stopper, out.deleted, 'deletion(s)', guard);
}

// Progress toasts (DESIGN 10.4), only where a spreadsheet UI exists: at the start of an export, with the
// pending writes flushed so the ledgers are visible before the calendar loop, and per finished calendar.
function gcalAnnounce(plan) {
  if (typeof SpreadsheetApp === 'undefined') return;
  var calendars = {};
  plan.rotations.forEach(function (r) { r.calendars.forEach(function (id) { calendars[id] = true; }); });
  toast('exporting ' + plan.events.length + ' event(s) to ' + Object.keys(calendars).length + ' calendar(s)', GCAL_TOAST_TITLE);
  SpreadsheetApp.flush();
}

function gcalProgress(line) {
  if (typeof SpreadsheetApp === 'undefined') return;
  toast(line.rotation + ' / ' + line.preset + ': ' + GCAL_COUNTS.map(function (c) { return c + ' ' + line[c]; }).join(', '), GCAL_TOAST_TITLE);
}

var GCAL_PROGRESS_MS = 10000;

// Ticker for the loops (10.4): per calendar a step function that toasts "<action> <calendar>: X / Y events
// done, N s" at most every ten seconds, the first at loop start; nothing without a spreadsheet UI.
function gcalTicker(action) {
  if (typeof SpreadsheetApp === 'undefined') return undefined;
  return function () {
    return throttledProgress(function (info) {
      toast(action + ' ' + info.calendar + ': ' + info.done + ' / ' + info.total + ' ' + info.what + ' done, ' + info.elapsed + ' s', GCAL_TOAST_TITLE);
    }, GCAL_PROGRESS_MS, Date.now);
  };
}

// Hook (DESIGN 8, Extensions): after a run without errors, export the regenerated rotations. A dry run, or a
// run that does not write, computes the counts only; without CalendarApp (Node) the plan is recorded as is.
// The status gets a Calendar block when a rotation uses cal or the presets have errors. options.export ===
// false leaves the export to the caller (the menu actions run the scheduler without writing).
function gcal_afterRun(result, storage, options) {
  if (options.export === false) return;
  var plan = gcalPlan(result, result.ext.gcal, {});
  var data = gcalStatusData(plan);
  var dry = !options.write || options.mode === 'dry run';
  if (typeof CalendarApp === 'undefined') { data.mode = 'no calendar'; data.elapsed = currentRunGuard().elapsedSeconds(); }
  else {
    if (dry) data.mode = 'dry run';
    if (plan.events.length) gcalAnnounce(plan);
    gcalReconcile(plan, data, { tz: storage.tz, dry: dry, progress: gcalProgress, ticker: gcalTicker('exporting') });
  }
  // The cal value's own errors go above its set row, only when the run writes (DESIGN 6).
  if (options.write) writeSettingErrors(result, storage, plan.errors, 'cal');
  gcalWriteCalendarErrors(storage, result.ext.gcal, data);
  // The extension's errors count as errors of the run and a stop note as a warning (DESIGN 6, 10.4).
  data.errors.forEach(function (e) { result.errors.push('GCal ' + e.where + ': ' + e.message); });
  if (data.note) result.status.warnings.push({ rotation: 'GCal', start: null, message: data.note });
  if (!plan.rotations.length && !data.errors.length) return;
  result.status.ext = result.status.ext || {};
  result.status.ext.gcal = data;
}

// ---- 60_menu.js ----
// GCal extension: menu actions, Set Up and #Help lines (DESIGN 13.5). Apps Script entry points; they use the
// core's SheetsStorage, runStorage, currentRotation and toast.
var GCAL_TOAST_TITLE = 'Rotalator calendar';
var GCAL_COLUMN_WIDTHS = [140, 120, 700];
var GCAL_TEMPLATE_PRESET = 'preset-1';
var GCAL_TEMPLATE_NOTE = 'First Google Calendar preset';
var GCAL_TEMPLATE_ID = 'FILL IN WITH CALENDAR ID';

// Cheat sheet shared by the #GCal template (comment rows in column C) and #Help: one line per setting with
// its values and default, the template variables, and how a rotation names presets. Built on call: the
// defaults live in another file.
function gcalCheatSheet() {
  return [
    'SETTINGS (one per row under a preset row: setting in B, value in C):',
    'id: calendar id, required (xxx@group.calendar.google.com, an address, primary)',
    'title: event title template, default ' + GCAL_DEFAULT_TITLE,
    'body: event description template, default ' + GCAL_DEFAULT_BODY,
    'allday: auto | true | false, default auto (all-day when the shift starts and ends at midnight)',
    'color: default (the calendar\'s own colour) | pale blue | pale green | mauve | pale red | yellow | orange | cyan | gray | blue | green | red | 1-11 | #RRGGBB (nearest), default default',
    'free: true | false, default true (the time shows as free)',
    'invite: true | false, default true (the assignee is invited when the id contains @)',
    'reminders: intervals before the start, 1d, 1h; default empty (the calendar defaults)',
    'TEMPLATES: {who} {rotation} {note} {pin} {start} {end}; {start:%a %e %b} with %Y %m %d %e %H %M %a %A %b %B %j %u',
    'USE: set cal=<preset> [<preset> ...] in a rotation or in #Global, then Run',
  ];
}

function gcalHelpLines() {
  return [
    '',
    'CALENDAR (GCal extension, #GCal tab: preset | setting | value):',
    'preset row: name in A (letters, digits, - _), note in C; setting rows below it: setting in B, value in C',
  ].concat(gcalCheatSheet().slice(1), [
    'export: after each run, one event per shift and preset from the stored snapshot to the horizon; tagged rotalator=<rotation>|<start>; untagged events never touched; nobody shifts skipped',
    'Re-export calendar [: current rotation]: every shift from the first one (repairs a cleaned or edited calendar)',
    'Clean calendar: current rotation | selected preset: delete the events Rotalator created for the rotation, or every Rotalator event of the preset\'s calendar',
  ]);
}

// Header, cheat sheet as comment rows, an empty row, then a first preset to fill in (reminders empty:
// calendar defaults; color default: the calendar's own colour).
function gcalTemplateRows() {
  var comment = function (text) { return ['', '', text]; };
  var setting = function (key, value) { return ['', key, value]; };
  return [PRESET_HEADER.slice()].concat(gcalCheatSheet().map(comment), [
    ['', '', ''],
    [GCAL_TEMPLATE_PRESET, '', GCAL_TEMPLATE_NOTE],
    setting('id', GCAL_TEMPLATE_ID),
    setting('title', GCAL_DEFAULT_TITLE),
    setting('body', GCAL_DEFAULT_BODY),
    setting('allday', 'auto'),
    setting('color', GCAL_COLOR_DEFAULT),
    setting('free', 'true'),
    setting('invite', 'true'),
    setting('reminders', ''),
  ]);
}

// Conditional row colours like the ledgers' (DESIGN 10.1): error rows light red, preset rows light blue like
// set rows, comment rows light yellow; the header row is excluded. Built here because the palette constants
// belong to the core's Apps Script file.
function gcalFormatRules() {
  return [
    { formula: '=$B1="' + PRESET_ERROR_TYPE + '"', color: COLOR_ERROR },
    { formula: '=AND($A1<>"", ROW()>1)', color: COLOR_SETTINGS },
    { formula: '=AND($A1="", $B1="", $C1<>"")', color: COLOR_COMMENT },
  ];
}

function gcal_menu(menu) {
  menu.addSeparator()
    .addItem('Re-export calendar', 'gcalReexport')
    .addItem('Re-export calendar: current rotation', 'gcalReexportCurrent')
    .addItem('Clean calendar: current rotation', 'gcalCleanCurrent')
    .addItem('Clean calendar: selected preset', 'gcalCleanPreset');
}

function gcal_help(lines) {
  return gcalHelpLines();
}

// #GCal is formatted as a preset tab (core formatPresetTab) with its widths and row colours.
function gcalFormatTab(sheet) {
  formatPresetTab(sheet, GCAL_COLUMN_WIDTHS, gcalFormatRules());
}

// Hook: creates #GCal after #Global with the template when missing or empty, places and formats it.
function gcal_setup(ss) {
  var sheet = ss.getSheetByName(GCAL_TAB);
  if (!sheet) {
    var global = ss.getSheetByName(GLOBAL_TAB);
    sheet = ss.insertSheet(GCAL_TAB, global ? global.getIndex() : ss.getNumSheets());
  }
  if (isEmptySheet(sheet)) writeTextCells(sheet, 1, gcalTemplateRows());
  placeTabAfter(ss, sheet, ss.getSheetByName(GLOBAL_TAB));
  gcalFormatTab(sheet);
  return sheet;
}

// Hook: Set Up Tab on #GCal fills an empty tab from the template; any other tab is left to the core.
function gcal_setupTab(sheet) {
  if (sheet.getName() !== GCAL_TAB) return false;
  if (!isEmptySheet(sheet)) { toast('"' + GCAL_TAB + '" is not empty; Set Up Tab only fills empty tabs', GCAL_TOAST_TITLE); return true; }
  writeTextCells(sheet, 1, gcalTemplateRows());
  gcalFormatTab(sheet);
  toast('"' + GCAL_TAB + '" set up from the template; fill in the calendar id of ' + GCAL_TEMPLATE_PRESET, GCAL_TOAST_TITLE);
  return true;
}

function gcalSummary(data) {
  var totals = {};
  GCAL_COUNTS.forEach(function (c) { totals[c] = data.lines.reduce(function (n, l) { return n + l[c]; }, 0); });
  var text = GCAL_COUNTS.map(function (c) { return c + ' ' + totals[c]; }).join(', ');
  if (data.elapsed !== undefined) text += ' in ' + data.elapsed + ' s';
  if (data.note) text += '; ' + data.note;
  return text + '; ' + finishedText(data.errors.length, data.note ? 1 : 0);
}

// Runs the scheduler without writing (the ledgers stay as they are) to get the plan inputs.
function gcalRunForExport(storage, rotations) {
  var options = { write: false, export: false };
  if (rotations) options.rotations = rotations;
  var result = runStorage(storage, storage.nowText, options);
  if (result.errors.length) toast(result.errors.length + ' error(s), nothing exported: ' + result.errors[0], GCAL_TOAST_TITLE);
  return result.errors.length ? null : result;
}

// Re-export: every shift from the first one, so a cleaned or hand-edited calendar is repaired.
function gcalExportWith(rotations) {
  var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
  var result = gcalRunForExport(storage, rotations);
  if (!result) return null;
  var plan = gcalPlan(result, result.ext.gcal, { repair: true, rotations: rotations || undefined });
  if (plan.events.length) gcalAnnounce(plan);
  var data = gcalReconcile(plan, gcalStatusData(plan), { tz: storage.tz, dry: false, progress: gcalProgress, ticker: gcalTicker('re-exporting') });
  gcalWriteCalendarErrors(storage, result.ext.gcal, data);
  data.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(gcalSummary(data), GCAL_TOAST_TITLE);
  return data;
}

// The menu actions run under the core's script lock (DESIGN 10.4), like Run.
function gcalReexport() {
  return withLock(function () { return gcalExportWith(null); });
}

function gcalReexportCurrent() {
  var name = currentRotation();
  return name === null ? null : withLock(function () { return gcalExportWith([name]); });
}

function gcalCleanNote(out) {
  return (out.note ? '; ' + out.note : '') + '; ' + finishedText(out.errors.length, out.note ? 1 : 0);
}

function gcalCleanCurrent() {
  var name = currentRotation();
  if (name === null) return null;
  return withLock(function () {
    var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
    var result = gcalRunForExport(storage, null);
    if (!result) return null;
    var clean = gcalCleanPlan(result, result.ext.gcal, { rotation: name });
    var out = gcalClean(clean, { tz: storage.tz, ticker: gcalTicker('cleaning') });
    clean.errors.concat(out.errors).forEach(function (e) { console.log(e.where + ': ' + e.message); });
    toast(out.deleted + ' event(s) of ' + name + ' deleted in ' + clean.calendars.length + ' calendar(s) in ' + out.elapsed + ' s' + gcalCleanNote(out), GCAL_TOAST_TITLE);
    return out;
  });
}

// The active cell's row in #GCal names the preset; a setting row counts for the preset above it.
function gcalSelectedPreset(sheet) {
  if (sheet.getName() !== GCAL_TAB) return null;
  var row = sheet.getActiveRange().getRow();
  var names = sheet.getRange(1, 1, Math.max(row, 1), 1).getValues();
  while (row > 1 && cellText(names[row - 1][0]) === '') row--;
  return row > 1 ? cellText(names[row - 1][0]) : null;
}

// Deletes every Rotalator event of the selected preset's calendar within a wide window around now.
function gcalCleanPreset() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = gcalSelectedPreset(ss.getActiveSheet());
  if (name === null) { toast('select a preset row in ' + GCAL_TAB, GCAL_TOAST_TITLE); return null; }
  return withLock(function () {
    var storage = new SheetsStorage(ss);
    var clean = gcalCleanPlan(null, gcal_readInputs(storage), { preset: name });
    if (clean.error) { toast(clean.error, GCAL_TOAST_TITLE); return null; }
    var window = gcalCleanWindow(parseDateTime(storage.nowText));
    var out = gcalClean(clean, { tz: storage.tz, from: window.from, to: window.to, ticker: gcalTicker('cleaning') });
    out.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
    toast(out.deleted + ' Rotalator event(s) deleted in ' + clean.calendar + ' between ' + window.from + ' and ' + window.to + ' in ' + out.elapsed + ' s' + gcalCleanNote(out), GCAL_TOAST_TITLE);
    return out;
  });
}

