// Preset tabs and message templates shared by the extensions (DESIGN 8, Extensions; 13.1, 13.2). Extensions
// call these with their own settings tables and placeholder lists and never each other.
var PRESET_HEADER = ['preset', 'setting', 'value'];
var PRESET_ERROR_TYPE = 'error';
var PRESET_NAME_RE = /^[A-Za-z0-9_-]+$/;
var TEMPLATE_INSTANTS = ['start', 'end'];
var TEMPLATE_PLACEHOLDER_RE = /\{([A-Za-z]+)(?::([^{}]*))?\}/g;
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The same rule as the cal and slack settings, so every preset can be named there.
function isValidPresetName(name) {
  return PRESET_NAME_RE.test(name);
}

function newPreset(name, note, row, settings) {
  var preset = { name: name, note: note, row: row, setRows: {}, errors: [] };
  Object.keys(settings).forEach(function (key) { preset[key] = settings[key].def; });
  return preset;
}

// rows: cell rows below the header preset | setting | value, error rows already dropped: a non-empty column A
// starts a preset (C is its note), an empty A with a non-empty B is a setting of the current preset (C is the
// whole value), A and B empty is a comment. settings: { key: { parse, def, hint, template, required } }: parse
// returns null on a bad value, def is the value of an unset setting, hint names the accepted forms in errors,
// a template setting parses to a string or an array of strings that are checked for unknown placeholders
// (options.placeholders, or the setting's own placeholders list) and directives once, a required setting is
// reported on the preset row when missing.
// options: { tab, placeholders, check }; tab labels the errors, check(preset) returns a message for the
// preset row or null. Returns { presets, errors }: every preset in tab order with its own errors list (a
// preset with errors is unusable) and setRows (the tab row of each setting given), and the flat errors as
// { row, where, message }: row the 1-based row of the tab as given (header 1), where '<tab> row N' with N the
// offending row's position once the error rows are written above it (presetRowsWithErrors), so it matches
// the tab the user sees.
function parsePresetTab(rows, settings, options) {
  var tab = options.tab;
  var placeholders = options.placeholders || [];
  var presets = [];
  var errors = [];
  var current = null;
  var seen = {};
  var fail = function (row, preset, message) {
    errors.push({ row: row, where: null, message: message });
    if (preset) preset.errors.push(message);
  };
  (rows || []).forEach(function (cells, i) {
    var name = cellText(cells[0]);
    var key = cellText(cells[1]).toLowerCase();
    var value = cellText(cells[2]);
    if (name !== '') {
      current = newPreset(name, value, i + 2, settings);
      presets.push(current);
      if (!isValidPresetName(name)) fail(i + 2, current, 'bad preset name "' + name + '"; use letters, digits, - and _ without spaces');
      else if (seen[name]) fail(i + 2, current, 'duplicate preset "' + name + '"');
      seen[name] = true;
      return;
    }
    if (key === '') return;
    if (current === null) { fail(i + 2, null, 'setting "' + key + '" before any preset'); return; }
    var spec = settings[key];
    if (!spec) { fail(i + 2, current, 'unknown setting "' + key + '"'); return; }
    if (current.setRows[key] !== undefined) { fail(i + 2, current, 'duplicate setting "' + key + '"'); return; }
    current.setRows[key] = i + 2;
    var parsed = spec.parse(value);
    if (parsed === null) { fail(i + 2, current, 'bad value for ' + key + ': "' + value + '"' + (spec.hint ? '; use ' + spec.hint : '')); return; }
    if (spec.template) {
      [].concat(parsed).forEach(function (t) { templateErrors(t, key, spec.placeholders || placeholders).forEach(function (message) { fail(i + 2, current, message); }); });
    }
    current[key] = parsed;
  });
  presets.forEach(function (preset) {
    Object.keys(settings).forEach(function (key) {
      if (!settings[key].required || preset[key] !== null) return;
      errors.push({ row: preset.row, where: null, message: 'preset "' + preset.name + '" has no ' + key });
      preset.errors.push('no ' + key);
    });
    var message = options.check ? options.check(preset) : null;
    if (message) fail(preset.row, preset, message);
  });
  errors.sort(function (a, b) { return a.row - b.row; });
  // The offending row moves down by one per error row written at or above it: all errors up to the last one
  // on the same row.
  var above = 0, last = null;
  errors.forEach(function (e, k) {
    if (e.row !== last) { last = e.row; above = k + errors.filter(function (x) { return x.row === e.row; }).length; }
    e.where = tab + ' row ' + (e.row + above);
  });
  return { presets: presets, errors: errors };
}

function isPresetErrorRow(cells) {
  return cellText(cells[0]) === '' && cellText(cells[1]).toLowerCase() === PRESET_ERROR_TYPE;
}

// The tab without the script's error rows (DESIGN 1: error rows are removed and recomputed on every run).
function dropPresetErrorRows(rows) {
  return rows.filter(function (cells) { return !isPresetErrorRow(cells); });
}

// The tab with an error row (| error | message) directly above each row an error names ({ row, message },
// sorted by row here, equal rows in list order); rows are the cleaned rows the errors were computed on.
// Rows are padded to the header width.
function presetRowsWithErrors(rows, errors) {
  var out = rows.map(function (cells) {
    return PRESET_HEADER.map(function (_, i) { return cells[i] === undefined || cells[i] === null ? '' : cells[i]; });
  });
  var sorted = errors.slice().sort(function (a, b) { return a.row - b.row; });
  for (var k = sorted.length - 1; k >= 0; k--) {
    out.splice(sorted[k].row - 2, 0, ['', PRESET_ERROR_TYPE, sorted[k].message]);
  }
  return out;
}

// strftime subset over a naive instant: %Y %m %d %e (day without padding) %H %M %a %A %b %B %j %u (Monday 1),
// %% a percent sign. Returns { text, unknown: ['%q', ...] }; a trailing % is an unknown directive too.
function strftime(format, min) {
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
      case 'a': return DAY_NAMES[weekday].slice(0, 3);
      case 'A': return DAY_NAMES[weekday];
      case 'b': return MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
      case 'B': return MONTH_NAMES[d.getUTCMonth()];
      case 'j': return String(day - dayIndex(Date.UTC(d.getUTCFullYear(), 0, 1) / 60000) + 1).padStart(3, '0');
      case 'u': return String(weekday === 0 ? 7 : weekday);
      case '%': return '%';
      default: unknown.push(directive); return directive;
    }
  });
  return { text: text, unknown: unknown };
}

// values: { name: value }; its keys are the allowed placeholders, names case-insensitive. start and end are
// instants in minutes and take an optional strftime format after a colon ({start:%a %e %b}); without one they
// give the sheet's datetime form. Unknown placeholders and directives stay verbatim and are listed in unknown.
function formatTemplate(template, values) {
  var unknown = [];
  var text = template.replace(TEMPLATE_PLACEHOLDER_RE, function (whole, rawName, format) {
    var name = rawName.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, name)) { unknown.push('{' + rawName + '}'); return whole; }
    var value = values[name];
    if (TEMPLATE_INSTANTS.indexOf(name) < 0) return value === null || value === undefined ? '' : String(value);
    if (format === undefined) return formatDateTime(value);
    var out = strftime(format, value);
    unknown.push.apply(unknown, out.unknown);
    return out.text;
  });
  return { text: text, unknown: unknown };
}

// Messages for the unknown placeholders and directives of a template, each once; names are the allowed
// placeholders.
function templateErrors(template, field, names) {
  var sample = {};
  names.forEach(function (name) { sample[name] = TEMPLATE_INSTANTS.indexOf(name) < 0 ? '' : 0; });
  var seen = {};
  var out = [];
  formatTemplate(template, sample).unknown.forEach(function (u) {
    if (seen[u]) return;
    seen[u] = true;
    out.push('unknown ' + (u.charAt(0) === '{' ? 'placeholder ' : 'directive ') + u + ' in ' + field);
  });
  return out;
}
