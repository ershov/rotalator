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
  return parseGCalPresets(typeof storage.readGCal === 'function' ? storage.readGCal() : []);
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

// Presets named by the rotation's cal value, in order; unknown names and presets with errors are reported and
// skipped.
function gcalRotationPresets(cal, inputs, rotation, errors) {
  var out = [];
  (cal === '' ? [] : cal.split(' ')).forEach(function (name) {
    var preset = gcalPreset(inputs, name);
    if (!preset) errors.push({ where: rotation, message: 'unknown preset "' + name + '" in cal; add it to ' + GCAL_TAB });
    else if (preset.errors.length) errors.push({ where: rotation, message: 'preset "' + name + '" skipped: ' + preset.errors.join('; ') });
    else out.push(preset);
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
// Returns { rotations: [{ rotation, presets, calendars, from, to, shifts, skipped }], events, errors }; events
// in rotation, start, preset order; skipped counts the nobody shifts inside the window.
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
    plan.rotations.push({
      rotation: rot.name,
      presets: presets.map(function (p) { return p.name; }),
      calendars: presets.map(function (p) { return p.id; }),
      from: formatDateTime(window.from),
      to: formatDateTime(window.to),
      shifts: wanted.length,
      skipped: inside.length - wanted.length,
    });
    wanted.forEach(function (shift) {
      presets.forEach(function (preset) { plan.events.push(gcalEvent(rot.name, preset, shift)); });
    });
  });
  return plan;
}

// Clean plan: { rotation, calendars, from, to, keys } for every shift of a rotation (the adapter deletes the
// tagged events with these keys in the window), or { calendar, all: true } for a preset (every tagged event).
function gcalCleanPlan(run, inputs, target) {
  if (target.preset !== undefined) {
    var preset = gcalPreset(inputs, target.preset);
    return preset ? { preset: preset.name, calendar: preset.id, all: true } : { error: 'unknown preset "' + target.preset + '"' };
  }
  var rot = run && run.status ? run.status.rotations.find(function (r) { return r.name === target.rotation; }) : null;
  if (!rot) return { error: 'unknown rotation "' + target.rotation + '"' };
  var errors = [];
  var cal = rot.settings.values.find(function (s) { return s.key === 'cal'; });
  var presets = gcalRotationPresets(cal ? cal.value : '', inputs, rot.name, errors);
  var shifts = gcalRotationShifts(run, rot.name);
  var last = shifts.reduce(function (max, s) { return Math.max(max, s.end); }, rot.horizonEnd);
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

