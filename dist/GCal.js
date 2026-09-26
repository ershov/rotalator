// ---- 10_presets.js ----
// GCal extension: calendar presets from the #GCal tab or gcal.csv (DESIGN, Google Calendar extension).
// Rows below the header preset | setting | value: a non-empty column A starts a preset (C is its note), an
// empty A with a non-empty B is a setting of the current preset (C is the whole value), A and B empty is a
// comment. Everything of the extension is prefixed gcal.
var GCAL_HEADER = ['preset', 'setting', 'value'];
var GCAL_DEFAULT_TITLE = '{rotation}: {who}';
var GCAL_DEFAULT_BODY = 'Rotalator shift {rotation} {start} to {end}. {note}';
// CalendarApp.EventColor names and their numbers.
var GCAL_COLORS = { PALE_BLUE: 1, PALE_GREEN: 2, MAUVE: 3, PALE_RED: 4, YELLOW: 5, ORANGE: 6, CYAN: 7, GRAY: 8, BLUE: 9, GREEN: 10, RED: 11 };

function gcalParseText(text) {
  return text === '' ? null : text;
}

function gcalParseColor(text) {
  var n = parseInteger(text);
  if (n !== null) return n >= 1 && n <= 11 ? n : null;
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
// for unknown placeholders and directives once, at parse time.
var GCAL_SETTINGS = {
  id:        { parse: gcalParseText,      def: null,               hint: 'a calendar id' },
  title:     { parse: gcalParseText,      def: GCAL_DEFAULT_TITLE, template: true },
  body:      { parse: gcalParseText,      def: GCAL_DEFAULT_BODY,  template: true },
  allday:    { parse: gcalParseAllday,    def: 'auto',             hint: 'auto, true or false' },
  color:     { parse: gcalParseColor,     def: null,               hint: 'a Calendar colour name like pale blue, or 1 to 11' },
  free:      { parse: parseBoolean,       def: true,               hint: 'true or false' },
  invite:    { parse: parseBoolean,       def: true,               hint: 'true or false' },
  reminders: { parse: gcalParseReminders, def: [],                 hint: 'comma-separated clock intervals like 1d, 2h, 30m' },
};

function gcalIsValidPresetName(name) {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

function gcalNewPreset(name, note, row) {
  var preset = { name: name, note: note, row: row, errors: [] };
  Object.keys(GCAL_SETTINGS).forEach(function (key) { preset[key] = GCAL_SETTINGS[key].def; });
  return preset;
}

// rows: cell rows below the header. Returns { presets, errors }: every preset in tab order with its own
// errors list (a preset with errors is unusable), and the flat errors as { where, message } with where
// '#GCal row N'. The same name rule as the cal setting applies, so every preset can be named there.
function parseGCalPresets(rows) {
  var presets = [];
  var errors = [];
  var current = null;
  var seen = {};
  var where = function (i) { return GCAL_TAB + ' row ' + (i + 2); };
  var fail = function (i, preset, message) {
    errors.push({ where: where(i), message: message });
    if (preset) preset.errors.push(message);
  };
  (rows || []).forEach(function (cells, i) {
    var name = cellText(cells[0]);
    var key = cellText(cells[1]).toLowerCase();
    var value = cellText(cells[2]);
    if (name !== '') {
      current = gcalNewPreset(name, value, i + 2);
      presets.push(current);
      if (!gcalIsValidPresetName(name)) fail(i, current, 'bad preset name "' + name + '"; use letters, digits, - and _ without spaces');
      else if (seen[name]) fail(i, current, 'duplicate preset "' + name + '"');
      seen[name] = true;
      current.set = {};
      return;
    }
    if (key === '') return;
    if (current === null) { fail(i, null, 'setting "' + key + '" before any preset'); return; }
    var spec = GCAL_SETTINGS[key];
    if (!spec) { fail(i, current, 'unknown setting "' + key + '"'); return; }
    if (current.set[key]) { fail(i, current, 'duplicate setting "' + key + '"'); return; }
    current.set[key] = true;
    var parsed = spec.parse(value);
    if (parsed === null) { fail(i, current, 'bad value for ' + key + ': "' + value + '"' + (spec.hint ? '; use ' + spec.hint : '')); return; }
    if (spec.template) gcalTemplateErrors(parsed, key).forEach(function (message) { fail(i, current, message); });
    current[key] = parsed;
  });
  presets.forEach(function (preset) {
    delete preset.set;
    if (preset.id === null) {
      errors.push({ where: where(preset.row - 2), message: 'preset "' + preset.name + '" has no id' });
      preset.errors.push('no id');
    }
  });
  return { presets: presets, errors: errors };
}

function gcalPreset(inputs, name) {
  return (inputs && inputs.presets || []).find(function (p) { return p.name === name; }) || null;
}

// Hook: the extension's inputs, read through the storage before the run (DESIGN 8, Extensions).
function gcal_readInputs(storage) {
  return parseGCalPresets(typeof storage.readTabRows === 'function' ? storage.readTabRows(GCAL_TAB, GCAL_HEADER) : []);
}

// ---- 20_format.js ----
// GCal extension: event titles and bodies from templates. Placeholders {who} {rotation} {note} {pin} {start}
// {end}; {start} and {end} take an optional strftime format, {start:%a %d %b}. Unknown placeholders and
// directives stay verbatim and are reported.
var GCAL_PLACEHOLDERS = ['who', 'rotation', 'note', 'pin', 'start', 'end'];
var GCAL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var GCAL_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var GCAL_PLACEHOLDER_RE = /\{([A-Za-z]+)(?::([^{}]*))?\}/g;

// strftime subset over a naive instant: %Y %m %d %e (day without padding) %H %M %a %A %b %B %j %u (Monday 1),
// %% a percent sign. Returns { text, unknown: ['%q', ...] }; a trailing % is an unknown directive too.
function gcalStrftime(format, min) {
  var d = new Date(min * 60000);
  var day = dayIndex(min);
  var weekday = weekdayOfDay(day);
  var unknown = [];
  var text = format.replace(/%(.?)/g, function (directive, c) {
    switch (c) {
      case 'Y': return String(d.getUTCFullYear()).padStart(4, '0');
      case 'm': return pad2(d.getUTCMonth() + 1);
      case 'd': return pad2(d.getUTCDate());
      case 'e': return String(d.getUTCDate());
      case 'H': return pad2(d.getUTCHours());
      case 'M': return pad2(d.getUTCMinutes());
      case 'a': return GCAL_DAY_NAMES[weekday].slice(0, 3);
      case 'A': return GCAL_DAY_NAMES[weekday];
      case 'b': return GCAL_MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
      case 'B': return GCAL_MONTH_NAMES[d.getUTCMonth()];
      case 'j': return String(day - dayIndex(Date.UTC(d.getUTCFullYear(), 0, 1) / 60000) + 1).padStart(3, '0');
      case 'u': return String(weekday === 0 ? 7 : weekday);
      case '%': return '%';
      default: unknown.push(directive); return directive;
    }
  });
  return { text: text, unknown: unknown };
}

// values: { who, rotation, note, pin, start, end } with start and end as minutes. Placeholder names are
// case-insensitive. Returns { text, unknown }.
function gcalFormat(template, values) {
  var unknown = [];
  var text = template.replace(GCAL_PLACEHOLDER_RE, function (whole, rawName, format) {
    var name = rawName.toLowerCase();
    if (GCAL_PLACEHOLDERS.indexOf(name) < 0) { unknown.push('{' + rawName + '}'); return whole; }
    var value = values[name];
    if (name !== 'start' && name !== 'end') return value === null || value === undefined ? '' : String(value);
    if (format === undefined) return formatDateTime(value);
    var out = gcalStrftime(format, value);
    unknown.push.apply(unknown, out.unknown);
    return out.text;
  });
  return { text: text, unknown: unknown };
}

// Messages for the unknown placeholders and directives of a template, each once.
function gcalTemplateErrors(template, field) {
  var sample = { who: '', rotation: '', note: '', pin: '', start: 0, end: 0 };
  var seen = {};
  var out = [];
  gcalFormat(template, sample).unknown.forEach(function (u) {
    if (seen[u]) return;
    seen[u] = true;
    out.push('unknown ' + (u.charAt(0) === '{' ? 'placeholder ' : 'directive ') + u + ' in ' + field);
  });
  return out;
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
// on the same calendar (its events would share the first one's keys) are reported and skipped.
function gcalRotationPresets(cal, inputs, rotation, errors) {
  var out = [];
  var calendars = {};
  (cal === '' ? [] : cal.split(' ')).forEach(function (name) {
    var preset = gcalPreset(inputs, name);
    if (!preset) errors.push({ where: rotation, message: 'unknown preset "' + name + '" in cal; add it to ' + GCAL_TAB });
    else if (preset.errors.length) errors.push({ where: rotation, message: 'preset "' + name + '" skipped: ' + preset.errors.join('; ') });
    else if (calendars[preset.id]) errors.push({ where: rotation, message: 'preset "' + name + '" skipped: calendar ' + preset.id + ' is already used by preset "' + calendars[preset.id] + '"' });
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
    color: preset.color,
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

// Hook: rows for #Status from status.ext.gcal (DESIGN 8, Extensions); nothing without it.
function gcal_status(status) {
  var data = status.ext && status.ext.gcal;
  if (!data) return null;
  var rows = [['Calendar' + (data.mode ? ' (' + data.mode + ')' : '')], ['rotation', 'preset', 'calendar'].concat(GCAL_COUNTS)];
  var headerRows = [0, 1];
  (data.lines || []).forEach(function (line) {
    rows.push([line.rotation, line.preset, line.calendar].concat(GCAL_COUNTS.map(function (c) { return String(line[c]); })));
  });
  var errors = data.errors || [];
  if (errors.length) {
    headerRows.push(rows.length);
    rows.push(['calendar errors', 'where', 'message']);
    errors.forEach(function (e) { rows.push(['', e.where, e.message]); });
  }
  return { rows: rows, headerRows: headerRows };
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

// Fields of an existing event that differ from the desired one. A preset without color leaves the colour alone.
function gcalDiff(state, want) {
  var diff = [];
  if (state.title !== want.title) diff.push('title');
  if (state.body !== want.body) diff.push('body');
  if (state.allDay !== want.allDay || state.start !== want.start || state.end !== want.end) diff.push('time');
  if (want.color !== null && state.color !== String(want.color)) diff.push('color');
  if (state.free !== want.free) diff.push('free');
  if (!gcalSameList(state.guests, gcalGuests(want.guests))) diff.push('guests');
  if (!gcalSameList(state.reminders, gcalSorted(want.reminders))) diff.push('reminders');
  return diff;
}

// All-day end dates are exclusive, like the plan's end.
function gcalApplyTime(ev, want, tz) {
  var start = gcalToDate(want.start, tz, want.allDay), end = gcalToDate(want.end, tz, want.allDay);
  if (want.allDay) ev.setAllDayDates(start, end);
  else ev.setTime(start, end);
}

// The reminders are exactly the preset's: none when it sets none, so the calendar defaults never drift in.
function gcalApplyReminders(ev, want) {
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

// Reconciles every calendar of the plan and fills the counts of data (gcalStatusData). options: tz, and dry to
// compute the counts without writing. Creates and updates stay inside [from, to); the rotation's tagged
// events are fetched up to `until` (the clean bound after now), so events left beyond a shortened horizon are
// deleted too. A missing calendar or an API failure is recorded in data.errors and the other calendars
// proceed. Duplicate events with one key are deleted down to one.
function gcalReconcile(plan, data, options) {
  var tz = options.tz;
  var dry = Boolean(options.dry);
  plan.rotations.forEach(function (rot) {
    rot.presets.forEach(function (preset, i) {
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
        wanted.forEach(function (want) {
          var ev = existing[want.key];
          delete existing[want.key];
          if (!ev) { if (!dry) gcalCreate(calendar, want, tz); line.create++; return; }
          var state = gcalEventState(ev, tz);
          var diff = gcalDiff(state, want);
          if (!diff.length) { line.unchanged++; return; }
          if (!dry) gcalUpdate(ev, state, want, diff, tz);
          line.update++;
        });
        Object.keys(existing).map(function (key) { return existing[key]; }).concat(duplicates).forEach(function (ev) {
          if (!dry) ev.deleteEvent();
          line.delete++;
        });
      } catch (e) {
        data.errors.push({ where: rot.rotation + ' / ' + preset, message: e && e.message ? e.message : String(e) });
      }
    });
  });
  return data;
}

// Deletes tagged events per a clean plan (gcalCleanPlan): a rotation's events (tag prefix rotation|) in its
// window in each of its calendars, or every tagged event of one calendar between options.from and options.to.
// Returns { deleted, errors }.
function gcalClean(clean, options) {
  var out = { deleted: 0, errors: [] };
  var targets = clean.all
    ? [{ calendar: clean.calendar, prefix: '', from: options.from, to: options.to }]
    : clean.calendars.map(function (id) { return { calendar: id, prefix: clean.rotation + '|', from: clean.from, to: clean.to }; });
  targets.forEach(function (t) {
    try {
      var calendar = CalendarApp.getCalendarById(t.calendar);
      if (!calendar) throw new Error('calendar "' + t.calendar + '" not found or not shared with this account');
      calendar.getEvents(gcalToDate(t.from, options.tz), gcalToDate(t.to, options.tz)).forEach(function (ev) {
        var key = ev.getTag(GCAL_TAG);
        if (!key || key.indexOf(t.prefix) !== 0) return;
        if (!options.dry) ev.deleteEvent();
        out.deleted++;
      });
    } catch (e) {
      out.errors.push({ where: t.calendar, message: e && e.message ? e.message : String(e) });
    }
  });
  return out;
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
  if (typeof CalendarApp === 'undefined') data.mode = 'no calendar';
  else {
    if (dry) data.mode = 'dry run';
    gcalReconcile(plan, data, { tz: storage.tz, dry: dry });
  }
  if (!plan.rotations.length && !data.errors.length) return;
  result.status.ext = result.status.ext || {};
  result.status.ext.gcal = data;
}

// ---- 60_menu.js ----
// GCal extension: menu actions, Set Up and #Help lines (DESIGN 13.5). Apps Script entry points; they use the
// core's SheetsStorage, runStorage, currentRotation and toast.
var GCAL_TOAST_TITLE = 'Rotalator calendar';
var GCAL_COLUMN_WIDTHS = [120, 120, 640];

// Comment rows (A and B empty) written into a new #GCal tab.
var GCAL_TEMPLATE_HELP = [
  'PRESETS: a row with a name in column A starts a preset (C: a note); each row below it with an empty A sets one setting: B the key, C the value',
  'SETTINGS: id (calendar id, required), title, body, allday (auto | true | false), color (a Calendar colour name or 1 to 11), free (true | false), invite (true | false), reminders (1d, 1h)',
  'EXAMPLE: team | | Shared team calendar   then   | id | team@group.calendar.google.com   then   | color | pale blue   then   | reminders | 1d, 1h',
  'USE: set cal=team (space-separated preset names) in a rotation or in #Global, then Run; share each calendar with write access to the account that runs',
];

var GCAL_HELP_LINES = [
  '',
  'CALENDAR (GCal extension):',
  'cal=team personal: presets of the #GCal tab whose calendars receive the rotation\'s shifts after each run, one event per shift and preset, from the stored snapshot to the horizon',
  '#GCal rows: a name in column A starts a preset (C: note); the rows below with an empty A set id (required), title, body, allday (auto | true | false), color, free, invite, reminders',
  'templates: {who} {rotation} {note} {pin} {start} {end}; dates take a format, {start:%a %e %b} (%Y %m %d %e %H %M %a %A %b %B %j %u)',
  'Re-export calendar / Re-export calendar: current rotation: export every shift from the first one, repairing a calendar that was cleaned or edited',
  'Clean calendar: current rotation / Clean calendar: selected preset: delete the events Rotalator created for the rotation, or every Rotalator event of the preset\'s calendar',
  'events carry the tag rotalator=<rotation>|<start>; events without it are never touched; a shift with nobody gets no event',
];

function gcal_menu(menu) {
  menu.addSeparator()
    .addItem('Re-export calendar', 'gcalReexport')
    .addItem('Re-export calendar: current rotation', 'gcalReexportCurrent')
    .addItem('Clean calendar: current rotation', 'gcalCleanCurrent')
    .addItem('Clean calendar: selected preset', 'gcalCleanPreset');
}

function gcal_help(lines) {
  return GCAL_HELP_LINES.slice();
}

// Creates #GCal with its header and help rows when missing or empty, then formats it like an editable tab:
// script font, plain text, bold grey frozen header, widths, spare columns removed, grey tab colour.
function gcal_setup(ss) {
  var sheet = ss.getSheetByName(GCAL_TAB) || ss.insertSheet(GCAL_TAB);
  if (isEmptySheet(sheet)) {
    writeTextCells(sheet, 1, [GCAL_HEADER.slice()].concat(GCAL_TEMPLATE_HELP.map(function (text) { return ['', '', text]; })));
  }
  var width = GCAL_HEADER.length;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily(FONT_FAMILY);
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(COLOR_HEADER);
  sheet.setFrozenRows(1);
  GCAL_COLUMN_WIDTHS.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  trimColumns(sheet, width);
  sheet.setTabColor(TAB_COLOR_EDITABLE);
  return sheet;
}

function gcalSummary(data) {
  var totals = {};
  GCAL_COUNTS.forEach(function (c) { totals[c] = data.lines.reduce(function (n, l) { return n + l[c]; }, 0); });
  var text = GCAL_COUNTS.map(function (c) { return c + ' ' + totals[c]; }).join(', ');
  return text + (data.errors.length ? '; ' + data.errors.length + ' error(s): ' + data.errors[0].message : '');
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
  var data = gcalReconcile(plan, gcalStatusData(plan), { tz: storage.tz, dry: false });
  data.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(gcalSummary(data), GCAL_TOAST_TITLE);
  return data;
}

function gcalReexport() {
  return gcalExportWith(null);
}

function gcalReexportCurrent() {
  var name = currentRotation();
  return name === null ? null : gcalExportWith([name]);
}

function gcalCleanCurrent() {
  var name = currentRotation();
  if (name === null) return null;
  var storage = new SheetsStorage(SpreadsheetApp.getActiveSpreadsheet());
  var result = gcalRunForExport(storage, null);
  if (!result) return null;
  var clean = gcalCleanPlan(result, result.ext.gcal, { rotation: name });
  var out = gcalClean(clean, { tz: storage.tz });
  clean.errors.concat(out.errors).forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(out.deleted + ' event(s) of ' + name + ' deleted in ' + clean.calendars.length + ' calendar(s)' + (out.errors.length ? '; ' + out.errors[0].message : ''), GCAL_TOAST_TITLE);
  return out;
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
  var storage = new SheetsStorage(ss);
  var clean = gcalCleanPlan(null, gcal_readInputs(storage), { preset: name });
  if (clean.error) { toast(clean.error, GCAL_TOAST_TITLE); return null; }
  var window = gcalCleanWindow(parseDateTime(storage.nowText));
  var out = gcalClean(clean, { tz: storage.tz, from: window.from, to: window.to });
  out.errors.forEach(function (e) { console.log(e.where + ': ' + e.message); });
  toast(out.deleted + ' Rotalator event(s) deleted in ' + clean.calendar + ' between ' + window.from + ' and ' + window.to + (out.errors.length ? '; ' + out.errors[0].message : ''), GCAL_TOAST_TITLE);
  return out;
}

