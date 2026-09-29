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
