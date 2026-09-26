// GCal extension: calendar presets from the #GCal tab or gcal.csv (DESIGN, Google Calendar extension).
// Rows below the header preset | setting | value: a non-empty column A starts a preset (C is its note), an
// empty A with a non-empty B is a setting of the current preset (C is the whole value), A and B empty is a
// comment. Everything of the extension is prefixed gcal.
var GCAL_HEADER = ['preset', 'setting', 'value'];
var GCAL_DEFAULT_TITLE = '{rotation}: {who}';
var GCAL_DEFAULT_BODY = 'Rotalator shift {rotation} {start} to {end}. {note}';
// CalendarApp.EventColor names and their numbers, and the palette of the Calendar UI as hex RGB.
var GCAL_COLORS = { PALE_BLUE: 1, PALE_GREEN: 2, MAUVE: 3, PALE_RED: 4, YELLOW: 5, ORANGE: 6, CYAN: 7, GRAY: 8, BLUE: 9, GREEN: 10, RED: 11 };
var GCAL_COLOR_RGB = {
  PALE_BLUE: 'a4bdfc', PALE_GREEN: '7ae7bf', MAUVE: 'dbadff', PALE_RED: 'ff887c', YELLOW: 'fbd75b', ORANGE: 'ffb878',
  CYAN: '46d6db', GRAY: 'e1e1e1', BLUE: '5484ed', GREEN: '51b749', RED: 'dc2127',
};
var GCAL_COLOR_HINT = 'a Calendar colour name like pale blue, its number 1 to 11, or #RRGGBB (the nearest colour is used)';

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

// A colour name (spaces, dashes or underscores), a number 1 to 11, or #RRGGBB mapped to the nearest colour.
function gcalParseColor(text) {
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
// for unknown placeholders and directives once, at parse time.
var GCAL_SETTINGS = {
  id:        { parse: gcalParseText,      def: null,               hint: 'a calendar id' },
  title:     { parse: gcalParseText,      def: GCAL_DEFAULT_TITLE, template: true },
  body:      { parse: gcalParseText,      def: GCAL_DEFAULT_BODY,  template: true },
  allday:    { parse: gcalParseAllday,    def: 'auto',             hint: 'auto, true or false' },
  color:     { parse: gcalParseColor,     def: null,               hint: GCAL_COLOR_HINT },
  free:      { parse: parseBoolean,       def: true,               hint: 'true or false' },
  invite:    { parse: parseBoolean,       def: true,               hint: 'true or false' },
  reminders: { parse: gcalParseReminders, def: [],                 hint: 'comma-separated clock intervals like 1d, 2h, 30m, or empty for the calendar defaults' },
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
