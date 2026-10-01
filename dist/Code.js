// Setup: run this once from the Apps Script editor to install the Rotalator menu and authorise the script.
// It is the first function in the editor's list and only calls onOpen; everything else is below.
function Setup() {
  onOpen();
}

// ---- 00_util.js ----
// Datetimes are integer minutes since 1970-01-01T00:00, wall clock treated as UTC.

var MINUTES_PER_HOUR = 60;
var MINUTES_PER_DAY = 1440;
var MINUTES_PER_WEEK = 10080;

var DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// year >= 100 avoids Date.UTC mapping two-digit years to 19xx.
function validDate(year, month, day) {
  return year >= 100 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function makeDateTime(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

function parseDateTime(text) {
  if (typeof text !== 'string') return null;
  var m = DATETIME_RE.exec(text.trim());
  if (!m) return null;
  var year = +m[1], month = +m[2], day = +m[3];
  var hour = m[4] === undefined ? 0 : +m[4];
  var minute = m[5] === undefined ? 0 : +m[5];
  if (!validDate(year, month, day) || hour > 23 || minute > 59) return null;
  return makeDateTime(year, month, day, hour, minute);
}

// Returns a day index (days since 1970-01-01), the unit used for holidays.
function parseDay(text) {
  if (typeof text !== 'string') return null;
  var m = DATE_RE.exec(text.trim());
  if (!m) return null;
  var year = +m[1], month = +m[2], day = +m[3];
  if (!validDate(year, month, day)) return null;
  return makeDateTime(year, month, day, 0, 0) / MINUTES_PER_DAY;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// Canonical text; midnight is written as the bare date (DESIGN 3.3).
function formatDateTime(min) {
  var d = new Date(min * 60000);
  var date = String(d.getUTCFullYear()).padStart(4, '0') + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  var time = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  return time === '00:00' ? date : date + 'T' + time;
}

function formatDay(day) {
  return formatDateTime(day * MINUTES_PER_DAY);
}

function dayIndex(min) {
  return Math.floor(min / MINUTES_PER_DAY);
}

function dayStart(day) {
  return day * MINUTES_PER_DAY;
}

// 0 = Sunday .. 6 = Saturday. 1970-01-01 was a Thursday.
function weekdayOfDay(day) {
  return ((day + 4) % 7 + 7) % 7;
}

function weekday(min) {
  return weekdayOfDay(dayIndex(min));
}

var UNIT_MINUTES = { w: MINUTES_PER_WEEK, d: MINUTES_PER_DAY, h: MINUTES_PER_HOUR, m: 1 };
var UNIT_ORDER = 'wdhm';
var DURATION_TOKEN_RE = /^(\d+)\s*([wdhm])\s*/;

function parseDurationUnits(text, units) {
  if (typeof text !== 'string') return null;
  var rest = text.trim();
  if (rest === '') return null;
  var total = 0;
  var lastUnit = -1;
  while (rest !== '') {
    var m = DURATION_TOKEN_RE.exec(rest);
    if (!m) return null;
    var unit = UNIT_ORDER.indexOf(m[2]);
    if (units.indexOf(m[2]) < 0 || unit <= lastUnit) return null;
    lastUnit = unit;
    total += +m[1] * UNIT_MINUTES[m[2]];
    rest = rest.slice(m[0].length);
  }
  return total;
}

var INTERVAL_TOKEN_RE = /^(\d+(?:\.\d+)?)\s*(sl|ts|w|d|h|m)\s*/;

// Interval (DESIGN 3.3): { text, unit, amount, minutes }. unit 'clock' has whole minutes (a single token may be
// fractional if it still yields whole minutes, chained tokens are integers in descending order); 'sl' (shift length) and 'ts' (team size times
// shift length) stand alone with a fractional amount and are resolved at use time. A plain 0 is the zero interval.
function parseInterval(text) {
  if (typeof text !== 'string') return null;
  var rest = text.trim();
  if (rest === '') return null;
  if (/^0+(\.0+)?$/.test(rest)) return { text: '0', unit: 'clock', amount: 0, minutes: 0 };
  var tokens = [];
  while (rest !== '') {
    var m = INTERVAL_TOKEN_RE.exec(rest);
    if (!m) return null;
    tokens.push({ amount: Number(m[1]), unit: m[2], integer: m[1].indexOf('.') < 0 });
    rest = rest.slice(m[0].length);
  }
  var single = tokens[0];
  if (tokens.length === 1 && (single.unit === 'sl' || single.unit === 'ts')) {
    return { text: formatAmount(single.amount) + single.unit, unit: single.unit, amount: single.amount, minutes: null };
  }
  if (tokens.length === 1) {
    var minutes = single.amount * UNIT_MINUTES[single.unit];
    if (!Number.isInteger(minutes)) return null;
    return { text: formatAmount(single.amount) + single.unit, unit: 'clock', amount: single.amount, minutes: minutes };
  }
  var total = 0;
  var lastUnit = -1;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    var u = UNIT_ORDER.indexOf(t.unit);
    if (u < 0 || !t.integer || u <= lastUnit) return null;
    lastUnit = u;
    total += t.amount * UNIT_MINUTES[t.unit];
  }
  return { text: formatDuration(total), unit: 'clock', amount: null, minutes: total };
}

// Shortest decimal form of a non-negative amount, at most two decimals.
function formatAmount(n) {
  return String(Math.round(n * 100) / 100);
}

// Clock intervals as minutes; null for sl/ts or unparseable text.
function parseDuration(text) {
  var interval = parseInterval(text);
  return interval && interval.unit === 'clock' ? interval.minutes : null;
}

function parsePeriod(text) {
  var min = parseDurationUnits(text, 'wd');
  return min === null || min === 0 ? null : min;
}

function formatDuration(min) {
  if (!Number.isInteger(min) || min < 0) return null;
  if (min === 0) return '0m';
  var out = '';
  for (var i = 0; i < UNIT_ORDER.length; i++) {
    var u = UNIT_ORDER[i];
    var n = Math.floor(min / UNIT_MINUTES[u]);
    if (n > 0) {
      out += n + u;
      min -= n * UNIT_MINUTES[u];
    }
  }
  return out;
}

function splitList(text) {
  if (typeof text !== 'string') return [];
  return text.split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

var ASSIGNMENT_RE = /^([^=+]*?)\s*(\+=|-=|=)\s*(.*)$/;

// Returns [{ name, op, value }] or an error string. op is '=', '+=', '-=' or null.
function parseAssignments(text) {
  var items = splitList(text);
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var m = ASSIGNMENT_RE.exec(item);
    if (!m) {
      if (item.indexOf('+') >= 0) return 'bad assignment "' + item + '"';
      out.push({ name: item, op: null, value: null });
      continue;
    }
    var name = m[1].trim(), value = m[3].trim();
    if (name === '' || value === '' || /[=+]/.test(value)) return 'bad assignment "' + item + '"';
    out.push({ name: name, op: m[2], value: value });
  }
  return out;
}

// FNV-1a 32-bit over the UTF-8 encoding of the string.
function fnv1a32(str) {
  var h = 0x811c9dc5;
  for (var ch of str) {
    var c = ch.codePointAt(0);
    var bytes;
    if (c < 0x80) bytes = [c];
    else if (c < 0x800) bytes = [0xc0 | (c >> 6), 0x80 | (c & 0x3f)];
    else if (c < 0x10000) bytes = [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)];
    else bytes = [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)];
    for (var j = 0; j < bytes.length; j++) {
      h ^= bytes[j];
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

// RFC 4180 style. A blank line yields [''] so row numbers match line numbers.
function parseCsv(text) {
  var rows = [];
  var row = [];
  var field = '';
  var quoted = false;
  var lineStarted = false;
  var i = 0;
  var n = text.length;
  var endRow = function () {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    lineStarted = false;
  };
  while (i < n) {
    var c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    lineStarted = true;
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    field += c;
    i++;
  }
  if (lineStarted) endRow();
  return rows;
}

function formatCsvField(value) {
  var s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// A row with a single empty field is written as "" so the line is visibly a row.
function formatCsvRow(row) {
  var line = row.map(formatCsvField).join(',');
  return line === '' ? '""' : line;
}

function formatCsv(rows) {
  return rows.map(formatCsvRow).join('\n') + (rows.length ? '\n' : '');
}

// ---- 10_model.js ----
var LEDGER_HEADER = ['pin', 'start', 'type', 'what', 'end', 'duration', 'note'];

// Tabs (DESIGN 3.1). A name starting with '#' is never a rotation.
var SYSTEM_TAB_PREFIX = '#';
var HOLIDAYS_TAB = '#Holidays';
var GLOBAL_TAB = '#Global';
var STATUS_TAB = '#Status';
var ALL_SHIFTS_TAB = '#All shifts';
var HELP_TAB = '#Help';
var GCAL_TAB = '#GCal';
var SLACK_TAB = '#Slack';
var SLACK_STATE_TAB = '#Slack state';
var PREVIEW_TAB_PREFIX = '#Preview ';

function isSystemTab(name) {
  return name.charAt(0) === SYSTEM_TAB_PREFIX;
}

// Preview tab of a rotation tab (DESIGN 3.1); #Global has none, a preview writes nothing for it.
function previewTabName(name) {
  return PREVIEW_TAB_PREFIX + name;
}

function isPreviewTab(name) {
  return name.indexOf(PREVIEW_TAB_PREFIX) === 0;
}

function isKnownSystemTab(name) {
  return name === HOLIDAYS_TAB || name === GLOBAL_TAB || name === STATUS_TAB || name === ALL_SHIFTS_TAB ||
    name === HELP_TAB || extensionTabOwner(name) !== null || isPreviewTab(name);
}

// The extension that owns a reserved tab (DESIGN 8, Extensions): the core neither reads nor shapes it.
function extensionTabOwner(name) {
  if (name === GCAL_TAB) return 'GCal';
  if (name === SLACK_TAB || name === SLACK_STATE_TAB) return 'Slack';
  return null;
}

// order: same-instant sort (DESIGN 3.6). what: item grammar of the column (see validateWhat).
// required: what must not be empty (a set row may be empty: the minimal first row when #Global supplies the
// settings). extent: end/duration allowed. A row with an empty type is a comment (internal type 'comment',
// order -1): never validated, replayed or generated, only sorted.
var ROW_TYPES = {
  error:    { order: 0,  what: 'text',   required: true,  extent: false },
  set:      { order: 1,  what: 'set',    required: false, extent: false },
  attract:  { order: 2,  what: 'names',  required: true,  extent: true },
  'attract!': { order: 3, what: 'names', required: true,  extent: true },
  repel:    { order: 4,  what: 'names',  required: true,  extent: true },
  'repel!': { order: 5,  what: 'names',  required: true,  extent: true },
  detach:   { order: 6,  what: 'names',  required: true,  extent: true },
  snapshot: { order: 7,  what: 'scores', required: false, extent: false },
  team:     { order: 8,  what: 'team',   required: true,  extent: false },
  score:    { order: 9,  what: 'team',   required: true,  extent: false },
  join:     { order: 10, what: 'join',   required: true,  extent: false },
  leave:    { order: 11, what: 'names',  required: true,  extent: false },
  exclude:  { order: 12, what: 'names',  required: true,  extent: true },
  include:  { order: 13, what: 'names',  required: true,  extent: false },
  shift:    { order: 14, what: 'shift',  required: false, extent: true },
};

// Undated set, team, repel, repel!, attract and attract! rows (DESIGN 3.4) take the start of the nearest dated row above
// them as read (inheritStarts); with none above they are epoch rows that apply from the beginning of the
// timeline, start -Infinity internally so they sort and compare before every dated row.
var EPOCH = -Infinity;
var EPOCH_TYPES = ['set', 'team', 'repel', 'repel!', 'attract', 'attract!'];

function isEpochRow(row) {
  return row.start === EPOCH;
}

// First step on read: every undated row of an EPOCH_TYPE takes the start of the nearest row above it, in
// document order, that has a finite start and is neither an error row nor a comment. The start is
// materialised (startText in canonical form, end from a clock duration), so the row is written back dated and
// never drifts; rows with no dated row above stay epoch rows. Returns rows.
function inheritStarts(rows) {
  var above = null;
  rows.forEach(function (row) {
    if (row.type === 'error' || row.type === 'comment') return;
    if (isEpochRow(row)) {
      if (above === null) return;
      row.start = above;
      row.startText = formatDateTime(above);
      if (row.end === null && row.duration !== null) row.end = row.start + row.duration;
      return;
    }
    if (row.start !== null && isFinite(row.start)) above = row.start;
  });
  return rows;
}

var BASELINE_KEYWORDS = ['median', 'mean', 'min', 'max'];
var TIEBREAKS = ['order', 'shuffle'];
var GRID_MODES = ['calendar', 'counted'];

function parseNumber(text) {
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

function parseInteger(text) {
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function parseNonNegativeInteger(text) {
  var n = parseInteger(text);
  return n === null || n < 0 ? null : n;
}

function parseNonNegativeNumber(text) {
  var n = parseNumber(text);
  return n === null || n < 0 ? null : n;
}

function intervalIsPositive(interval) {
  return interval.unit === 'clock' ? interval.minutes > 0 : interval.amount > 0;
}

function parsePositiveInterval(text) {
  var interval = parseInterval(text);
  return interval && intervalIsPositive(interval) ? interval : null;
}

// tolerance: a plain number is score units (days); with a unit it is an interval resolved at use time.
function parseTolerance(text) {
  var n = parseNonNegativeNumber(text);
  return n !== null ? n : parseInterval(text);
}

function parseBoolean(text) {
  var t = text.toLowerCase();
  if (t === 'true' || t === 'yes' || t === '1') return true;
  if (t === 'false' || t === 'no' || t === '0') return false;
  return null;
}

function parseKeyword(list) {
  return function (text) {
    var t = text.toLowerCase();
    return list.indexOf(t) >= 0 ? t : null;
  };
}

var parseBaselineKeyword = parseKeyword(BASELINE_KEYWORDS);

// '=' values of join, team and score items: baseline keyword or number.
function parseBaseline(text) {
  var kw = parseBaselineKeyword(text);
  return kw !== null ? kw : parseNumber(text);
}

var INTERVAL_HINT = 'an interval like 2sl, 1ts, 3d or 0';
var POSITIVE_INTERVAL_HINT = 'a positive interval like 2sl, 1ts or 3d';
var AUTOPIN_HINT = 'false, or an interval relative to now like 0, 2w, -2w or 1sl, optionally marker:interval';
var AUTOPIN_MARKER = 'a';
var PRESET_NAMES_HINT = 'space-separated preset names of letters, digits, - and _';

// cal and slack (DESIGN 3.5): preset names for an extension, kept verbatim with single spaces between them.
function parsePresetNames(text) {
  var names = text.trim().split(/\s+/).filter(Boolean);
  return names.length && names.every(isValidPresetName) ? names.join(' ') : null;
}

// autopin (DESIGN 3.5): false, or [marker:]interval where the interval may carry a sign and the marker is
// everything before the last colon. Returns false, { marker, sign, interval, text } or null; text keeps the
// marker only when it was written (the default is spelled a:0).
function parseAutopin(text) {
  var t = text.trim();
  if (t.toLowerCase() === 'false') return false;
  var marker = AUTOPIN_MARKER;
  var colon = t.lastIndexOf(':');
  if (colon >= 0) {
    marker = t.slice(0, colon).trim();
    t = t.slice(colon + 1).trim();
    if (marker === '') return null;
  }
  var written = colon >= 0;
  var sign = 1;
  if (t.charAt(0) === '-') { sign = -1; t = t.slice(1).trim(); }
  var interval = parseInterval(t);
  if (interval === null) return null;
  var signed = (sign < 0 && interval.text !== '0' ? '-' : '') + interval.text;
  return { marker: marker, sign: sign, interval: interval, text: (written ? marker + ':' : '') + signed };
}

// def: initial value. bare: what a value-less key means: 'default' restores def, 'start' takes the row's
// start, 'none' is an error. parse null: the key takes no value. hint: accepted forms named in errors.
// Interval keys reject a plain number other than 0, so the old "number of shifts" reading is caught.
var SETTINGS = {
  period:        { parse: parsePeriod,             def: null,                 bare: 'none' },
  anchor:        { parse: null,                    def: null,                 bare: 'start' },
  grid:          { parse: parseKeyword(GRID_MODES), def: 'calendar',           bare: 'default' },
  horizon:       { parse: parsePositiveInterval,   def: parseInterval('20w'), bare: 'default', hint: POSITIVE_INTERVAL_HINT },
  skip_weekends: { parse: parseBoolean,            def: true,                 bare: 'default' },
  skip_holidays: { parse: parseBoolean,            def: true,                 bare: 'default' },
  tolerance:     { parse: parseTolerance,          def: parseTolerance('0.5sl'), bare: 'default', hint: 'a number of days or ' + INTERVAL_HINT },
  min_distance:  { parse: parseInterval,           def: parseInterval('0.5ts'), bare: 'default', hint: INTERVAL_HINT },
  tiebreak:      { parse: parseKeyword(TIEBREAKS), def: 'order',              bare: 'default' },
  seed:          { parse: parseInteger,            def: 0,                    bare: 'default' },
  baseline:      { parse: parseBaselineKeyword,    def: 'median',             bare: 'default' },
  precredit:     { parse: parseInterval,           def: parseInterval('1ts'), bare: 'default', hint: INTERVAL_HINT },
  autopin:       { parse: parseAutopin,            def: parseAutopin('a:2sl'), bare: 'default', hint: AUTOPIN_HINT },
  cal:           { parse: parsePresetNames,        def: '',                   bare: 'default', hint: PRESET_NAMES_HINT },
  slack:         { parse: parsePresetNames,        def: '',                   bare: 'default', hint: PRESET_NAMES_HINT },
};

function defaultSettings() {
  var out = {};
  for (var key in SETTINGS) out[key] = SETTINGS[key].def;
  return out;
}

// Returns { values: { key: parsed }, reset: [keys], error: string | null }. start is the row's start, used by
// bare anchor. reset lists the keys given bare that return to their default (and, in a rotation, to the
// global value); values carries the default for them too.
function parseSetArg(text, start) {
  var items = parseAssignments(text);
  var out = { values: {}, reset: [], error: null };
  if (typeof items === 'string') { out.error = items; return out; }
  var fail = function (message) { out.error = message; return out; };
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var key = it.name.toLowerCase();
    var spec = SETTINGS[key];
    if (!spec) return fail('unknown setting "' + it.name + '"');
    if (key in out.values) return fail('duplicate setting "' + it.name + '"');
    if (it.op !== null && it.op !== '=') return fail('set expects key or key=value, got "' + it.name + it.op + '"');
    var parsed;
    if (it.op === null) {
      if (spec.bare === 'none') return fail(it.name + ' requires a value');
      if (spec.bare === 'default') out.reset.push(key);
      parsed = spec.bare === 'start' ? start : spec.def;
    } else {
      if (!spec.parse) return fail(it.name + ' takes no value; the row start is the ' + it.name);
      parsed = spec.parse(it.value);
      if (parsed === null) return fail('bad value for ' + it.name + ': "' + it.value + '"' + (spec.hint ? '; use ' + spec.hint : ''));
    }
    out.values[key] = parsed;
  }
  return out;
}

function isNobody(what) {
  var w = (what ?? '').trim().toLowerCase();
  return w === '' || w === '-' || w === 'none';
}

function isValidMemberId(name) {
  return name !== '' && !/[,;=+]/.test(name);
}

// Items of a validated what column; [] when it does not parse.
function whatItems(row) {
  var items = parseAssignments(row.what);
  return typeof items === 'string' ? [] : items;
}

function whatNames(row) {
  return whatItems(row).map(function (it) { return it.name; });
}

// Assignee of a shift row, null for nobody.
function shiftAssignee(row) {
  return isNobody(row.what) ? null : row.what;
}

// false is empty so an unchecked checkbox in pin does not pin the row.
function cellText(cell) {
  return cell === null || cell === undefined || cell === false ? '' : String(cell).trim();
}

// A clock duration is resolved into end here; an sl/ts duration (durationInterval) is resolved by the
// scheduler once the grid and roster at start are known.
function rowFromArray(cells, rowIndex) {
  var pin = cellText(cells[0]);
  var startText = cellText(cells[1]);
  var endText = cellText(cells[4]);
  var durationText = cellText(cells[5]);
  var type = cellText(cells[2]).toLowerCase() || 'comment';
  var start = parseDateTime(startText);
  if (start === null && startText === '' && EPOCH_TYPES.indexOf(type) >= 0) start = EPOCH;
  var end = parseDateTime(endText);
  var interval = parseInterval(durationText);
  var duration = interval && interval.unit === 'clock' ? interval.minutes : null;
  if (end === null && duration !== null && start !== null && isFinite(start)) end = start + duration;
  return {
    rowIndex: rowIndex,
    pin: pin,
    pinned: pin !== '',
    start: start,
    startText: startText,
    type: type,
    what: cellText(cells[3]),
    end: end,
    endText: endText,
    duration: duration,
    durationInterval: interval,
    durationText: durationText,
    note: cellText(cells[6]),
  };
}

function makeRow(fields) {
  var row = {
    rowIndex: null, pin: '', pinned: false, start: null, startText: '', type: '', what: '',
    end: null, endText: '', duration: null, durationInterval: null, durationText: '', note: '',
  };
  for (var k in fields) row[k] = fields[k];
  if (fields.pin && !('pinned' in fields)) row.pinned = true;
  if (row.end === null && row.duration !== null && row.start !== null && isFinite(row.start)) row.end = row.start + row.duration;
  return row;
}

// Unparseable cells are written back verbatim. An end derived from duration is not written.
function rowToArray(row) {
  var duration = row.durationInterval ? row.durationInterval.text : row.duration !== null ? formatDuration(row.duration) : row.durationText;
  var derivedEnd = duration !== '' && row.endText === '';
  var end = derivedEnd ? '' : row.end !== null ? formatDateTime(row.end) : row.endText;
  return [
    row.pin,
    row.start !== null && isFinite(row.start) ? formatDateTime(row.start) : row.startText,
    row.type === 'comment' ? '' : row.type,
    row.what,
    end,
    duration,
    row.note,
  ];
}

function isLedgerHeader(cells) {
  if (!cells || cells.length < LEDGER_HEADER.length) return false;
  for (var i = 0; i < LEDGER_HEADER.length; i++) {
    if (cellText(cells[i]).toLowerCase() !== LEDGER_HEADER[i]) return false;
  }
  return true;
}

function typeOrder(type) {
  if (type === 'comment') return -1;
  return ROW_TYPES[type] ? ROW_TYPES[type].order : ROW_TYPES.shift.order + 1;
}

function rowsOfType(rows, type) {
  return rows.filter(function (r) { return r.type === type; });
}

function firstOfType(rows, types) {
  for (var i = 0; i < rows.length; i++) if (types.indexOf(rows[i].type) >= 0) return rows[i];
  return null;
}

function isUndatedComment(row) {
  return row.type === 'comment' && row.start === null;
}

var TRAILING_ORDER = ROW_TYPES.shift.order + 2;

// Sort key per row. An undated comment takes the start of the next dated row below it and an order just
// before it, so it sorts directly above that row whatever the array order; a stored key (attachComments)
// wins. Trailing undated comments keep a null start and sort after everything.
function sortKeys(rows) {
  var keys = new Array(rows.length);
  var pending = [];
  rows.forEach(function (row, i) {
    if (isUndatedComment(row)) {
      if (row.attachedStart !== undefined) keys[i] = { start: row.attachedStart, order: row.attachedOrder };
      else pending.push(i);
      return;
    }
    keys[i] = { start: row.start, order: typeOrder(row.type) };
    if (row.start === null) return;
    var attached = { start: row.start, order: keys[i].order - 0.5 };
    pending.forEach(function (j) { keys[j] = attached; });
    pending = [];
  });
  pending.forEach(function (j) { keys[j] = { start: null, order: TRAILING_ORDER }; });
  return keys;
}

// Resolves undated comments once, against the ledger as read, and stores the key on the row so later sorts
// keep each comment above the instant it was written at even when the row below it is regenerated.
function attachComments(rows) {
  var keys = sortKeys(rows);
  rows.forEach(function (row, i) {
    if (isUndatedComment(row)) { row.attachedStart = keys[i].start; row.attachedOrder = keys[i].order; }
  });
  return rows;
}

// Stable sort by start (nulls last), then DESIGN 3.6 type order; comments per sortKeys.
function sortRows(rows) {
  var keys = sortKeys(rows);
  var index = rows.map(function (_, i) { return i; });
  index.sort(function (i, j) {
    var a = keys[i], b = keys[j];
    if (a.start !== b.start) {
      if (a.start === null) return 1;
      if (b.start === null) return -1;
      return a.start - b.start;
    }
    return a.order - b.order;
  });
  return index.map(function (i) { return rows[i]; });
}

// One item grammar (DESIGN 3.3): name, name=value, name+=n, name-=n. Which forms a type accepts:
// names: bare names. join: name or name=baseline. team: all four, '=' baseline or number. scores: name=number.
function validateItem(grammar, type, it) {
  if (!isValidMemberId(it.name)) return 'bad member id "' + it.name + '"';
  if (grammar === 'names' && it.op !== null) return type + ' takes names only, got "' + it.name + it.op + '"';
  if (grammar === 'join' && it.op !== null && it.op !== '=') return 'join takes name or name=baseline, got "' + it.name + it.op + '"';
  if (grammar === 'scores' && it.op !== '=') return type + ' expects name=number, got "' + it.name + (it.op || '') + '"';
  if (it.op === '=') {
    var ok = grammar === 'scores' ? parseNumber(it.value) : parseBaseline(it.value);
    if (ok === null) return 'bad value for ' + it.name + ': "' + it.value + '"';
  } else if (it.op !== null && parseNumber(it.value) === null) {
    return 'bad adjustment for ' + it.name + ': "' + it.value + '"';
  }
  return null;
}

function validateWhat(row) {
  var grammar = ROW_TYPES[row.type].what;
  if (grammar === 'text') return null;
  if (grammar === 'set') return parseSetArg(row.what, row.start).error;
  var items = parseAssignments(row.what);
  if (grammar === 'shift') {
    if (isNobody(row.what)) return null;
    var one = typeof items !== 'string' && items.length === 1 && items[0].op === null && isValidMemberId(items[0].name);
    return one ? null : 'shift takes exactly one member id';
  }
  if (typeof items === 'string') return items;
  for (var i = 0; i < items.length; i++) {
    var message = validateItem(grammar, row.type, items[i]);
    if (message !== null) return message;
  }
  return null;
}

function validateRow(row) {
  var spec = ROW_TYPES[row.type];
  if (!spec) return row.type === '' ? 'missing type' : 'unknown type "' + row.type + '"';
  if (row.start === null) return row.startText === '' ? 'missing start' : 'bad start "' + row.startText + '"';
  if (isEpochRow(row)) {
    if (row.endText !== '' || row.durationText !== '') return 'undated ' + row.type + ' rows take no end or duration';
    if (row.type === 'set' && 'anchor' in parseSetArg(row.what, row.start).values) return 'anchor needs a dated set row';
  }
  if (row.endText !== '' && row.durationText !== '') return 'end and duration are mutually exclusive';
  if (row.endText !== '' && parseDateTime(row.endText) === null) return 'bad end "' + row.endText + '"';
  if (row.durationText !== '' && (!row.durationInterval || !intervalIsPositive(row.durationInterval))) return 'bad duration "' + row.durationText + '"; use ' + POSITIVE_INTERVAL_HINT;
  if (!spec.extent && (row.endText !== '' || row.durationText !== '')) return row.type + ' does not take end or duration';
  if (row.end !== null && row.end <= row.start) return 'end must be after start';
  if (spec.required && row.what === '') return row.type + ' requires what';
  return validateWhat(row);
}

function rowError(row, message) {
  return { rowIndex: row.rowIndex, start: row.start, startText: row.startText, message: message };
}

// Stateless checks of DESIGN 5.1 on rows as read (undated starts already inherited). Drops error rows; returns
// remaining rows sorted. Whether the grid is in force (period and anchor) is checked by the scheduler, where
// the settings timeline exists.
function validateLedger(rows, rotationName) {
  var errors = [];
  var kept = [];
  var snapshots = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.type === 'error') continue;
    kept.push(row);
    if (row.type === 'comment') continue;
    var message = validateRow(row);
    if (message === null && row.type === 'snapshot' && ++snapshots > 1) message = 'more than one snapshot row';
    if (message !== null) errors.push(rowError(row, message));
  }
  var sorted = sortRows(attachComments(kept));
  if (!firstOfType(sorted, Object.keys(ROW_TYPES))) {
    errors.push({ rowIndex: null, start: null, startText: '', message: rotationName + ': ledger is empty' });
  }
  return { rows: sorted, errors: errors };
}

// ---- 20_calendar.js ----
var COUNTED_DAY_SEARCH_LIMIT = 100000;

// Boundaries anchor + k*period (DESIGN 3.5, 4). With grid=counted the timeline is the concatenation of
// counted days (not skipped by skip_weekends/skip_holidays) and period counts counted days; an instant
// inside a skipped day projects onto the boundary between the adjacent counted days.
class Grid {
  constructor(settings, holidays) {
    this.period = settings.period;
    this.anchor = settings.anchor;
    this.counted = settings.grid === 'counted';
    this.options = { skip_weekends: settings.skip_weekends, skip_holidays: settings.skip_holidays, holidays: holidays };
    this.anchorDay = dayIndex(this.anchor);
    this.countCache = new Map();
    this.dayCache = new Map();
  }

  skipped(day) {
    return isSkippedDay(day, this.options);
  }

  // Counted days in [anchorDay, day), negative for days before the anchor day.
  countedBefore(day) {
    var n = this.countCache.get(day);
    if (n !== undefined) return n;
    n = 0;
    for (var d = Math.min(day, this.anchorDay); d < Math.max(day, this.anchorDay); d++) if (!this.skipped(d)) n++;
    if (day < this.anchorDay) n = -n;
    this.countCache.set(day, n);
    return n;
  }

  // The n-th counted day from the anchor day (0 is the first counted day at or after it).
  countedDay(n) {
    var cached = this.dayCache.get(n);
    if (cached !== undefined) return cached;
    var dir = n >= 0 ? 1 : -1;
    var d = n >= 0 ? this.anchorDay : this.anchorDay - 1;
    var k = n >= 0 ? 0 : -1;
    for (var i = 0; i < COUNTED_DAY_SEARCH_LIMIT; i++) {
      if (!this.skipped(d)) {
        this.dayCache.set(k, d);
        if (k === n) return d;
        k += dir;
      }
      d += dir;
    }
    return d;
  }

  // t itself, or the next boundary when t lies inside a skipped day of a counted grid.
  onCounted(t) {
    return this.counted && this.skipped(dayIndex(t)) ? this.ceil(t) : t;
  }

  // Wall-clock minutes to counted minutes and back; the identity in calendar mode.
  coord(t) {
    if (!this.counted) return t;
    var day = dayIndex(t);
    var base = this.countedBefore(day) * MINUTES_PER_DAY;
    return this.skipped(day) ? base : base + (t - dayStart(day));
  }

  instant(c) {
    if (!this.counted) return c;
    var n = Math.floor(c / MINUTES_PER_DAY);
    return dayStart(this.countedDay(n)) + (c - n * MINUTES_PER_DAY);
  }

  floor(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + Math.floor((this.coord(t) - a) / this.period) * this.period);
  }

  ceil(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + Math.ceil((this.coord(t) - a) / this.period) * this.period);
  }

  next(t) {
    var a = this.coord(this.anchor);
    return this.instant(a + (Math.floor((this.coord(t) - a) / this.period) + 1) * this.period);
  }

  // t moved by minutes along the grid's timeline; t + minutes in calendar mode.
  offset(t, minutes) {
    return this.instant(this.coord(t) + minutes);
  }
}

function isSkippedDay(day, options) {
  if (options.skip_weekends) {
    var w = weekdayOfDay(day);
    if (w === 0 || w === 6) return true;
  }
  return Boolean(options.skip_holidays && options.holidays && options.holidays.has(day));
}

// Fractional days covered by [a, b), per calendar day, skipping days per options
// { skip_weekends, skip_holidays, holidays: Set<dayIndex> }.
function units(a, b, options) {
  options = options || {};
  if (b <= a) return 0;
  var minutes = 0;
  for (var day = dayIndex(a), last = dayIndex(b - 1); day <= last; day++) {
    if (isSkippedDay(day, options)) continue;
    var from = Math.max(a, dayStart(day));
    var to = Math.min(b, dayStart(day + 1));
    minutes += to - from;
  }
  return minutes / MINUTES_PER_DAY;
}

function firstAfter(instants, t) {
  if (!instants) return null;
  for (var i = 0; i < instants.length; i++) if (instants[i] > t) return instants[i];
  return null;
}

// DESIGN 5.4. grid: the Grid effective at shift.start. gridChanges: ascending instants of set rows changing the grid.
function claimEnd(shift, nextShiftStart, grid, gridChanges) {
  var end = shift.end !== null ? shift.end : grid.next(shift.start);
  if (nextShiftStart !== null && nextShiftStart !== undefined && nextShiftStart < end) end = nextShiftStart;
  var change = firstAfter(gridChanges, shift.start);
  if (change !== null && change < end) end = change;
  return end;
}

// DESIGN 3.4: explicit end, else the earlier of the next shift start and the next grid boundary.
function scoredEnd(shift, nextShiftStart, grid) {
  if (shift.end !== null) return shift.end;
  var end = grid.next(shift.start);
  return nextShiftStart !== null && nextShiftStart !== undefined && nextShiftStart < end ? nextShiftStart : end;
}

// Minutes of an interval on the grid's timeline (DESIGN 3.3): sl is one period, ts is rosterSize periods.
function resolveInterval(interval, grid, rosterSize) {
  if (interval.unit === 'sl') return interval.amount * grid.period;
  if (interval.unit === 'ts') return interval.amount * grid.period * rosterSize;
  return interval.minutes;
}

// ---- 30_state.js ----
// Effective settings at an instant: the rotation's own values over the global ones over the defaults.
class Settings {
  constructor(values) {
    this.values = Object.assign(defaultSettings(), values || {});
  }

  clone() {
    return new Settings(this.values);
  }

  get(key) {
    return this.values[key];
  }

  // No grid without a period and an anchor (an epoch set row gives a period but never an anchor).
  grid(holidays) {
    return this.values.period === null || this.values.anchor === null ? null : new Grid(this.values, holidays);
  }

  unitsOptions(holidays) {
    return { skip_weekends: this.values.skip_weekends, skip_holidays: this.values.skip_holidays, holidays: holidays };
  }
}

var SETTING_LAYERS = ['rotation', 'global'];

function gridChangedBetween(before, after) {
  if (after.period !== before.period || after.anchor !== before.anchor || after.grid !== before.grid) return true;
  return after.grid === 'counted' && (after.skip_weekends !== before.skip_weekends || after.skip_holidays !== before.skip_holidays);
}

// Settings of a rotation over time (DESIGN 3.5): its own set rows layered over the global ones. A key the
// rotation has set wins until a bare key returns it to the global value; keys set in neither layer use the
// defaults. Entries hold the effective Settings and the source of each key after every set row of either
// layer, in start order (global before rotation at the same instant). Rows whose what does not parse are
// skipped, so callers may pass unvalidated rows. holidays: Set of day indexes.
class SettingsTimeline {
  constructor(setRows, holidays, globalSetRows) {
    this.holidays = holidays || new Set();
    this.entries = [];
    var layers = { global: {}, rotation: {} };
    var usable = function (r) { return r.start !== null && parseSetArg(r.what, r.start).error === null; };
    var events = sortRows((globalSetRows || []).filter(usable)).map(function (r) { return { row: r, layer: 'global' }; })
      .concat(sortRows(setRows.filter(usable)).map(function (r) { return { row: r, layer: 'rotation' }; }))
      .sort(function (a, b) { return a.row.start < b.row.start ? -1 : a.row.start > b.row.start ? 1 : 0; });
    var effective = function () {
      var values = defaultSettings();
      var sources = {};
      Object.keys(values).forEach(function (key) {
        sources[key] = 'default';
        SETTING_LAYERS.forEach(function (layer) {
          if (sources[key] === 'default' && key in layers[layer]) { values[key] = layers[layer][key]; sources[key] = layer; }
        });
      });
      return { values: values, sources: sources };
    };
    var before = effective();
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var layer = layers[ev.layer];
      var parsed = parseSetArg(ev.row.what, ev.row.start);
      Object.keys(parsed.values).forEach(function (key) { if (parsed.reset.indexOf(key) < 0) layer[key] = parsed.values[key]; });
      parsed.reset.forEach(function (key) { delete layer[key]; });
      var after = effective();
      // A period change without an explicit anchor re-anchors this layer at the row; an epoch row has no instant.
      if ('period' in parsed.values && after.values.period !== before.values.period && !('anchor' in parsed.values) && isFinite(ev.row.start)) {
        layer.anchor = ev.row.start;
        after = effective();
      }
      this.entries.push({
        start: ev.row.start, settings: new Settings(after.values), sources: after.sources,
        gridChanged: gridChangedBetween(before.values, after.values),
      });
      before = after;
    }
  }

  entryAt(t) {
    var found = null;
    for (var i = 0; i < this.entries.length && this.entries[i].start <= t; i++) found = this.entries[i];
    return found;
  }

  at(t) {
    var entry = this.entryAt(t);
    return entry ? entry.settings.clone() : new Settings();
  }

  // Instant from which the grid (period and anchor) is in force, or null when no set row of either layer
  // ever completes it. hasPeriod tells the two cases apart.
  gridStart() {
    var entry = this.entries.find(function (e) { return e.settings.get('period') !== null && e.settings.get('anchor') !== null; });
    return entry ? entry.start : null;
  }

  hasPeriod() {
    return this.entries.some(function (e) { return e.settings.get('period') !== null; });
  }

  // Source of each key at t: 'rotation', 'global' or 'default'.
  sourcesAt(t) {
    var entry = this.entryAt(t);
    if (entry) return Object.assign({}, entry.sources);
    var out = {};
    Object.keys(SETTINGS).forEach(function (key) { out[key] = 'default'; });
    return out;
  }

  // One Grid per entry, built on first use so its day caches survive across calls.
  gridAt(t) {
    var entry = this.entryAt(t);
    if (!entry) return null;
    if (entry.grid === undefined) entry.grid = entry.settings.grid(this.holidays);
    return entry.grid;
  }

  gridChanges() {
    return this.entries.filter(function (e) { return e.gridChanged; }).map(function (e) { return e.start; });
  }
}

// At most two decimals, trailing zeros and dot trimmed: 12.5, 14, 19.63, 0.
function formatScore(score) {
  var text = score.toFixed(2).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

// Clips [a, b) to start at `at`; b null is open. Returns null when nothing extends past `at`.
function clipToSnapshot(a, b, at) {
  if (at === null || at === undefined) return [a, b];
  if (b !== null && b <= at) return null;
  return [Math.max(a, at), b];
}

// Ordered members with scores and exclusions [{ from, to }], to null meaning open.
class Roster {
  constructor() {
    this.members = [];
  }

  size() {
    return this.members.length;
  }

  names() {
    return this.members.map(function (m) { return m.name; });
  }

  get(name) {
    for (var i = 0; i < this.members.length; i++) if (this.members[i].name === name) return this.members[i];
    return null;
  }

  has(name) {
    return this.get(name) !== null;
  }

  scores() {
    var out = {};
    this.members.forEach(function (m) { out[m.name] = m.score; });
    return out;
  }

  // kind: number, or 'median' | 'mean' | 'min' | 'max' over current scores. Empty roster gives 0.
  baseline(kind) {
    if (typeof kind === 'number') return kind;
    var scores = this.members.map(function (m) { return m.score; });
    if (!scores.length) return 0;
    if (kind === 'min') return Math.min.apply(null, scores);
    if (kind === 'max') return Math.max.apply(null, scores);
    var sum = scores.reduce(function (a, b) { return a + b; }, 0);
    if (kind === 'mean') return sum / scores.length;
    scores.sort(function (a, b) { return a - b; });
    var mid = scores.length >> 1;
    return scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  }

  addMember(name, baselineKind) {
    this.members.push({ name: name, score: this.baseline(baselineKind), exclusions: [] });
  }

  // items of a join row: name or name=baseline. Joiners are added one by one, so later baselines see earlier joiners.
  join(items, defaultBaseline) {
    for (var i = 0; i < items.length; i++) {
      if (this.has(items[i].name)) return 'join: "' + items[i].name + '" is already a member';
    }
    var self = this;
    items.forEach(function (it) { self.addMember(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline); });
    return null;
  }

  leave(names) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'leave: unknown member "' + unknown + '"';
    this.members = this.members.filter(function (m) { return names.indexOf(m.name) < 0; });
    return null;
  }

  // items of a team row. Leavers removed, joiners added, roster reordered, adjustments applied last.
  team(items, defaultBaseline) {
    var names = new Set();
    for (var i = 0; i < items.length; i++) {
      if (names.has(items[i].name)) return 'team: duplicate member "' + items[i].name + '"';
      names.add(items[i].name);
    }
    this.members = this.members.filter(function (m) { return names.has(m.name); });
    var existing = new Set(this.names());
    var self = this;
    items.forEach(function (it) {
      if (!existing.has(it.name)) self.addMember(it.name, it.op === '=' ? parseBaseline(it.value) : defaultBaseline);
    });
    this.members = items.map(function (it) { return self.get(it.name); });
    items.forEach(function (it) {
      if (it.op !== '=' || existing.has(it.name)) self.adjust(self.get(it.name), it);
    });
    return null;
  }

  // '=' sets to a number or to an aggregate of the current scores; '+=' and '-=' adjust; a bare name does nothing.
  adjust(member, it) {
    if (it.op === '=') member.score = this.baseline(parseBaseline(it.value));
    else if (it.op === '+=') member.score += Number(it.value);
    else if (it.op === '-=') member.score -= Number(it.value);
  }

  // items of a score row: same forms as team, only the members mentioned change.
  score(items) {
    for (var i = 0; i < items.length; i++) {
      var m = this.get(items[i].name);
      if (!m) return 'score: unknown member "' + items[i].name + '"';
      this.adjust(m, items[i]);
    }
    return null;
  }

  unknownMember(names) {
    for (var i = 0; i < names.length; i++) if (!this.has(names[i])) return names[i];
    return null;
  }

  exclude(names, from, to) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'exclude: unknown member "' + unknown + '"';
    var self = this;
    names.forEach(function (n) { self.get(n).exclusions.push({ from: from, to: to === undefined ? null : to }); });
    return null;
  }

  // Closes every exclusion of each name active at `at`.
  include(names, at) {
    var unknown = this.unknownMember(names);
    if (unknown !== null) return 'include: unknown member "' + unknown + '"';
    for (var i = 0; i < names.length; i++) {
      var closed = false;
      this.get(names[i]).exclusions.forEach(function (ex) {
        if (ex.from <= at && (ex.to === null || ex.to > at)) { ex.to = at; closed = true; }
      });
      if (!closed) return 'include: no active exclusion for "' + names[i] + '"';
    }
    return null;
  }

  isExcluded(who, a, b) {
    var m = this.get(who);
    if (!m) return false;
    return m.exclusions.some(function (ex) { return ex.from < b && (ex.to === null || ex.to > a); });
  }

  credit(who, units) {
    var m = this.get(who);
    if (m) m.score += units;
  }

  snapshotWhat() {
    return this.members.map(function (m) { return m.name + '=' + formatScore(m.score); }).join(', ');
  }

  fromSnapshotWhat(text) {
    var items = parseAssignments(text);
    this.members = typeof items === 'string' ? [] : items.map(function (it) {
      return { name: it.name, score: Number(it.value), exclusions: [] };
    });
  }
}

// ---- 40_scheduler.js ----
// Sweep item order at equal start: row types use ROW_TYPES order; script items slot in between.
function sweepOrder(kind, type) {
  if (kind === 'row') return typeOrder(type);
  if (kind === 'snapshot') return typeOrder('snapshot');
  if (kind === 'precredit') return typeOrder('shift') - 0.5;
  return typeOrder('shift');
}

function raiseTo(a, b) {
  if (b === null || b === undefined) return a;
  return a === null ? b : Math.max(a, b);
}

function ledgerRows(rows) {
  return sortRows(rows.filter(function (r) { return r.type !== 'error' && r.type !== 'comment' && r.start !== null; }));
}

// An instant inside a skipped day of a counted grid moves to the next boundary, so S never lands there.
function onCountedDay(timeline, t) {
  var grid = t === null || t === undefined || !isFinite(t) ? null : timeline.gridAt(t);
  return grid ? grid.onCounted(t) : t;
}

// DESIGN 5.2. now may be null to skip the clock-dependent steps. holidays: Set of day indexes.
// globalSetRows: the set rows of #Global.
function advance(rows, now, holidays, globalSetRows) {
  rows = ledgerRows(rows);
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows);
  var snapshot = firstOfType(rows, ['snapshot']);
  resolveDurations(rows, timeline, rosterSizeAt(rows, snapshot ? snapshot.start : null, snapshot ? snapshot.what : ''));
  var S = null;
  if (now !== null && now !== undefined) {
    var grid = timeline.gridAt(now);
    if (grid) S = grid.floor(now);
    var shifts = rowsOfType(rows, 'shift');
    for (var i = shifts.length - 1; i >= 0; i--) {
      if (shifts[i].start > now) continue;
      var shiftGrid = timeline.gridAt(shifts[i].start);
      var next = shifts[i + 1] ? shifts[i + 1].start : null;
      if (shiftGrid && scoredEnd(shifts[i], next, shiftGrid) > now) S = shifts[i].start;
      break;
    }
    S = raiseTo(S, onCountedDay(timeline, timeline.at(now).get('anchor')));
  }
  var roster = firstOfType(rows, ['team', 'join']);
  S = raiseTo(S, roster ? onCountedDay(timeline, roster.start) : null);
  S = raiseTo(S, snapshot ? snapshot.start : null);
  return S;
}

// Spans of [a, b) not covered by claims (sorted by start).
function uncoveredSpans(a, b, claims) {
  var spans = [];
  var t = a;
  for (var i = 0; i < claims.length && t < b; i++) {
    var cs = claims[i][0], ce = claims[i][1];
    if (ce <= t) continue;
    if (cs > t) spans.push([t, Math.min(cs, b)]);
    t = Math.max(t, ce);
  }
  if (t < b) spans.push([t, b]);
  return spans;
}

// Splits [a, b) at grid boundaries and grid changes into slot entries.
function splitSlots(a, b, timeline, changes, out) {
  var t = a;
  while (t < b) {
    var end = Math.min(timeline.gridAt(t).next(t), b);
    var change = firstAfter(changes, t);
    if (change !== null && change < end) end = change;
    out.push({ start: t, slotEnd: end, end: null, who: null, slot: true, row: null });
    t = end;
  }
}

function errorRow(e) {
  return makeRow({ type: 'error', start: e.start, startText: e.startText || '', what: e.message });
}

// Effective end per member of each exclude row once include rows are applied, to decide clipping at the snapshot.
function resolvedExcludeEnds(rows) {
  var ends = new Map();
  rows.forEach(function (row) {
    if (row.type === 'exclude') {
      var perName = {};
      whatNames(row).forEach(function (n) { perName[n] = row.end; });
      ends.set(row, perName);
    }
    if (row.type !== 'include') return;
    var names = whatNames(row);
    rows.forEach(function (ex) {
      var perName = ends.get(ex);
      if (!perName || ex.start > row.start) return;
      names.forEach(function (n) {
        if (n in perName && (perName[n] === null || perName[n] > row.start)) perName[n] = row.start;
      });
    });
  });
  return ends;
}

// Roster members over time from the snapshot roster and the team/join/leave rows after it: a function of t
// returning the member names at t. Row errors are left to the sweep.
function rosterNamesAt(rows, previousAt, previousWhat) {
  var roster = new Roster();
  roster.fromSnapshotWhat(previousWhat);
  var initial = roster.names();
  var points = [];
  rows.forEach(function (row) {
    if (row.start === null || (previousAt !== null && row.start < previousAt)) return;
    if (row.type === 'team') roster.team(whatItems(row), 'median');
    else if (row.type === 'join') roster.join(whatItems(row), 'median');
    else if (row.type === 'leave') roster.leave(whatNames(row));
    else return;
    points.push({ t: row.start, names: roster.names() });
  });
  return function (t) {
    var names = initial;
    points.forEach(function (p) { if (p.t <= t) names = p.names; });
    return names;
  };
}

// Roster size over time, for ts intervals that must be resolved before the sweep.
function rosterSizeAt(rows, previousAt, previousWhat) {
  var namesAt = rosterNamesAt(rows, previousAt, previousWhat);
  return function (t) { return namesAt(t).length; };
}

// sl/ts durations become an end on the grid effective at the row's start (DESIGN 3.3).
function resolveDurations(rows, timeline, sizeAt) {
  rows.forEach(function (row) {
    var interval = row.durationInterval;
    if (row.end !== null || row.start === null || !interval || interval.unit === 'clock') return;
    var grid = timeline.gridAt(row.start);
    if (grid) row.end = grid.offset(row.start, resolveInterval(interval, grid, sizeAt(row.start)));
  });
}

// frozen (DESIGN 5, run scope): the rotation is swept as it stands so relations see its shifts, but nothing is
// pruned, no slot is filled and the snapshot stays where it is; it is not written. globalSetRows: #Global.
// The script's domain (DESIGN 5.3, 5.4) is everything after the stored snapshot P: unpinned shifts there are
// pruned and every uncovered span from P (or, without a snapshot, from the first boundary at or after the first
// roster row) up to horizonEnd is filled, past spans included. An unpinned shift with nobody is never kept, so
// an unassignable slot at P re-emits its error row and a run stays idempotent. Without a snapshot (first run)
// unpinned shifts before now (before S when now is unknown) are hand-typed history and are kept; autopin then
// pins them and P protects them from the next run on.
function prepareRotation(input, index, holidays, frozen, globalSetRows, now) {
  var validated = validateLedger(input.rows, input.name);
  var rot = { name: input.name, index: index, frozen: frozen, rows: validated.rows, errors: validated.errors.slice(), problems: [], warnings: [] };
  if (rot.errors.length) return rot;
  var rows = rot.rows;
  rows.forEach(function (r) {
    if (r.type === 'comment' && r.start === null && r.startText !== '') {
      rot.warnings.push({ start: null, message: 'comment row ' + r.rowIndex + ': unparseable start, treated as undated' });
    }
  });
  var timeline = new SettingsTimeline(rowsOfType(rows, 'set'), holidays, globalSetRows);
  var previous = firstOfType(rows, ['snapshot']);
  var S = frozen || input.snapshotAt === null || input.snapshotAt === undefined ? advance(rows, null, holidays, globalSetRows) : input.snapshotAt;
  // The schedule starts where the grid takes effect: a period from any set row and an anchor from a dated one
  // of either layer. No dated row may precede that instant (it would have no grid).
  var gridAt = timeline.gridStart();
  var firstDated = rows.find(function (r) { return r.type !== 'comment' && r.start !== null && isFinite(r.start); });
  if (gridAt === null) {
    var missing = timeline.hasPeriod() ? 'no anchor; add a dated set anchor row here or in ' : 'no period in force; add period to a set row here or in ';
    rot.errors.push({ rowIndex: null, start: null, startText: '', message: input.name + ': ' + missing + GLOBAL_TAB });
    return rot;
  }
  if (firstDated && firstDated.start < gridAt) {
    rot.errors.push(rowError(firstDated, input.name + ': row before the anchor at ' + formatDateTime(gridAt)));
    return rot;
  }
  S = raiseTo(raiseTo(S, previous ? previous.start : null), onCountedDay(timeline, gridAt));
  rot.timeline = timeline;
  rot.previousAt = previous ? previous.start : null;
  rot.previousWhat = previous ? previous.what : '';
  rot.S = S;
  rot.namesAt = rosterNamesAt(rows, rot.previousAt, rot.previousWhat);
  rot.sizeAt = function (t) { return rot.namesAt(t).length; };
  resolveDurations(rows, timeline, rot.sizeAt);
  var P = rot.previousAt;
  var historyEnd = now === null || now === undefined ? S : now;
  rot.kept = rows.filter(function (r) {
    if (r.type === 'snapshot') return false;
    if (frozen || r.type !== 'shift' || r.pinned) return true;
    var assigned = shiftAssignee(r) !== null;
    if (P === null) return assigned && r.start < historyEnd;
    return r.start < P || (r.start === P && assigned);
  });

  var shifts = rowsOfType(rot.kept, 'shift');
  var changes = timeline.gridChanges();
  var claims = shifts.map(function (s, i) {
    return [s.start, claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes)];
  });
  var gridS = timeline.gridAt(S);
  var horizonAt = gridS.offset(S, resolveInterval(timeline.at(S).get('horizon'), gridS, rot.sizeAt(S)));
  rot.horizonEnd = timeline.gridAt(horizonAt).ceil(horizonAt);
  var roster = firstOfType(rows, ['team', 'join']);
  var fillStart = P !== null ? Math.max(P, gridAt)
    : roster && isFinite(roster.start) ? timeline.gridAt(roster.start).ceil(roster.start) : gridAt;
  rot.fillStart = fillStart;

  var entries = shifts.map(function (s) {
    return { start: s.start, slotEnd: null, end: null, who: shiftAssignee(s), slot: false, row: s };
  });
  if (!frozen) {
    uncoveredSpans(fillStart, rot.horizonEnd, claims).forEach(function (span) {
      splitSlots(span[0], span[1], timeline, changes, entries);
    });
  }
  entries.sort(function (a, b) { return a.start - b.start; });
  entries.forEach(function (e, i) {
    e.end = e.slot ? e.slotEnd : scoredEnd(e.row, entries[i + 1] ? entries[i + 1].start : null, timeline.gridAt(e.start));
  });
  rot.entries = entries;
  return rot;
}

function rotationItems(rot) {
  var items = [];
  var P = rot.previousAt;
  var S = rot.S;
  var push = function (start, kind, data) {
    items.push(Object.assign({ start: start, order: sweepOrder(kind, data.row ? data.row.type : null), rot: rot.index, kind: kind }, data));
  };
  var afterPrevious = function (t) { return P === null || t >= P; };
  var excludeEnds = resolvedExcludeEnds(rot.kept);
  rot.roster = new Roster();
  rot.roster.fromSnapshotWhat(rot.previousWhat);
  rot.precredited = new Set();
  rot.kept.forEach(function (row) {
    if (row.type === 'shift' || row.type === 'comment' || row.type === 'set' || isRelationRow(row)) return;
    if (row.type === 'exclude') {
      var ends = excludeEnds.get(row);
      var names = whatNames(row).filter(function (n) { return clipToSnapshot(row.start, ends[n], P) !== null; });
      var from = P === null ? row.start : Math.max(row.start, P);
      if (names.length) push(from, 'row', { row: row, names: names, from: from, to: row.end, clipped: from !== row.start });
    } else if (afterPrevious(row.start)) {
      push(row.start, 'row', { row: row });
    }
  });
  push(S, 'snapshot', {});
  push(S, 'precredit', {});
  rot.entries.forEach(function (entry) {
    if (entry.slot) { push(entry.start, 'slot', { entry: entry, row: entry.row }); return; }
    if (entry.who === null) return;
    var clip = clipToSnapshot(entry.start, entry.end, P);
    if (!clip) return;
    if (clip[0] < S && S < clip[1]) {
      push(clip[0], 'credit', { entry: entry, row: entry.row, a: clip[0], b: S });
      push(S, 'tail', { entry: entry, a: S, b: clip[1] });
    } else {
      push(clip[0], 'credit', { entry: entry, row: entry.row, a: clip[0], b: clip[1] });
    }
  });
  return items;
}

function mergeItems(rots) {
  var items = [];
  rots.forEach(function (rot) { items = items.concat(rotationItems(rot)); });
  return items.sort(function (a, b) {
    return (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || (rots[a.rot].rank - rots[b.rot].rank) || (a.order - b.order);
  });
}

// Settings at an instant come from the timeline (own and global set rows), so set rows are not sweep items.
function applyStateRow(rot, item) {
  var row = item.row;
  var roster = rot.roster;
  var settings = rot.timeline.at(item.start);
  switch (row.type) {
    case 'team': return roster.team(whatItems(row), settings.get('baseline'));
    case 'join': return roster.join(whatItems(row), settings.get('baseline'));
    case 'leave': return roster.leave(whatNames(row));
    case 'score': return roster.score(whatItems(row));
    case 'exclude': {
      var names = item.clipped ? item.names.filter(function (n) { return roster.has(n); }) : item.names;
      return names.length ? roster.exclude(names, item.from, item.to) : null;
    }
    case 'include': return roster.include(whatNames(row), row.start);
    default: return null;
  }
}

// The window is the precredit interval after S on the grid's timeline (DESIGN 5.5).
function precredit(rot, holidays) {
  var settings = rot.timeline.at(rot.S);
  var grid = rot.timeline.gridAt(rot.S);
  var limit = grid.offset(rot.S, resolveInterval(settings.get('precredit'), grid, rot.roster.size()));
  var options = settings.unitsOptions(holidays);
  rot.entries.forEach(function (entry) {
    if (entry.slot || !entry.row.pinned || entry.who === null || entry.start <= rot.S || entry.start >= limit) return;
    if (!rot.roster.has(entry.who)) return;
    rot.roster.credit(entry.who, units(entry.start, entry.end, options));
    rot.precredited.add(entry);
  });
}

function hasShiftOverlapping(rot, who, a, b) {
  return rot.entries.some(function (e) { return e.who === who && e.start < b && e.end > a; });
}

function previousAssignee(rot, entry) {
  var previous = null;
  for (var i = 0; i < rot.entries.length && rot.entries[i].start < entry.start; i++) previous = rot.entries[i];
  return previous ? previous.who : null;
}

// DESIGN 5.7 steps 3 and 4.
function tiebreak(rot, entry, candidates, settings) {
  var names = rot.roster.names();
  var chosen = new Set(candidates.map(function (m) { return m.name; }));
  if (settings.get('tiebreak') === 'shuffle') {
    var prefix = settings.get('seed') + '|' + rot.name + '|' + formatDateTime(entry.start) + '|';
    var best = null, bestHash = null;
    names.forEach(function (name) {
      if (!chosen.has(name)) return;
      var h = fnv1a32(prefix + name);
      if (bestHash === null || h < bestHash) { best = name; bestHash = h; }
    });
    return best;
  }
  var from = names.indexOf(previousAssignee(rot, entry)) + 1;
  for (var k = 0; k < names.length; k++) {
    var name = names[(from + k) % names.length];
    if (chosen.has(name)) return name;
  }
  return null;
}

// Tolerance in score units at slot start a: a plain number as is; sl the units a regular shift earns there
// honouring skips, ts that times the roster size, clock units nominal days (DESIGN 3.5).
function toleranceUnits(tolerance, grid, a, rosterSize, options) {
  if (typeof tolerance === 'number') return tolerance;
  if (tolerance.unit === 'clock') return tolerance.minutes / MINUTES_PER_DAY;
  var shift = units(a, grid.offset(a, grid.period), options);
  return tolerance.amount * shift * (tolerance.unit === 'ts' ? rosterSize : 1);
}

// min_distance relaxation ladder: the full distance, then one period less each time, then 0 (DESIGN 5.7).
function distanceLadder(distance, period) {
  var ladder = [];
  for (var d = distance; d > 0; d -= period) ladder.push(d);
  ladder.push(0);
  return ladder;
}

// DESIGN 5.7 and 7. Exclusions are never violated. Relaxation order: the repel! cross window shrinks one
// period per step to zero (plain repel) with min_distance in force, then min_distance steps down, then repel
// is dropped (warning), then nobody. attract and attract! holders are preferred inside the band; with no
// preferred candidate in band, the band widens to the lowest eligible attract! holder within one team round
// (lowest + tolerance + 1ts) and the pick proceeds inside it.
function assignSlot(rot, entry, holidays, ctx) {
  var settings = rot.timeline.at(entry.start);
  var roster = rot.roster;
  var a = entry.start, b = entry.slotEnd;
  var grid = rot.timeline.gridAt(a);
  var options = settings.unitsOptions(holidays);
  var minDistance = resolveInterval(settings.get('min_distance'), grid, roster.size());
  var ladder = distanceLadder(minDistance, grid.period);
  var partners = strongPartners(ctx, rot, a, minDistance);
  var cross = partners.reduce(function (max, p) { return Math.max(max, p.distance); }, 0);
  var windowed = repelledHolders(ctx, rot, a, b, grid, partners, 0);
  var repelled = repelledHolders(ctx, rot, a, b, grid, partners, cross);
  var members = roster.members.filter(function (m) { return !roster.isExcluded(m.name, a, b); });
  var pick = null;
  var attempt = function (pool, d, found) {
    if (pick) return;
    var from = grid.offset(a, -d), to = grid.offset(b, d);
    var eligible = pool.filter(function (m) { return !hasShiftOverlapping(rot, m.name, from, to); });
    if (eligible.length) pick = Object.assign({ eligible: eligible, distance: d }, found);
  };
  distanceLadder(cross, grid.period).forEach(function (remaining) {
    var pool = members.filter(function (m) { return !repelledHolders(ctx, rot, a, b, grid, partners, cross - remaining).has(m.name); });
    attempt(pool, minDistance, { cross: remaining, repelDropped: false });
  });
  var unrepelled = members.filter(function (m) { return !repelled.has(m.name); });
  ladder.slice(1).forEach(function (d) { attempt(unrepelled, d, { cross: 0, repelDropped: false }); });
  // Dropping repel only adds repelled members back, so a pick made here is always a repelled one.
  if (repelled.size) ladder.forEach(function (d) { attempt(members, d, { cross: 0, repelDropped: true }); });
  var warnings = [];
  if (pick) {
    var lowest = Math.min.apply(null, pick.eligible.map(function (m) { return m.score; }));
    var tolerance = toleranceUnits(settings.get('tolerance'), grid, a, roster.size(), options);
    var candidates = pick.eligible.filter(function (m) { return m.score <= lowest + tolerance; });
    var attracted = relatedHolders(ctx, rot, 'attract', a, b);
    var strong = relatedHolders(ctx, rot, 'attract!', a, b);
    strong.forEach(function (names, who) { attracted.set(who, (attracted.get(who) || []).concat(names)); });
    var preferred = candidates.filter(function (m) { return attracted.has(m.name); });
    var widened = null;
    if (!preferred.length && strong.size) {
      var cap = lowest + tolerance + toleranceUnits({ unit: 'ts', amount: 1 }, grid, a, roster.size(), options);
      var holders = pick.eligible.filter(function (m) { return strong.has(m.name) && m.score <= cap; });
      if (holders.length) {
        var holder = holders.reduce(function (low, m) { return m.score < low.score ? m : low; }, holders[0]);
        widened = { score: holder.score, partners: strong.get(holder.name) };
        candidates = pick.eligible.filter(function (m) { return m.score <= widened.score; });
        preferred = candidates.filter(function (m) { return attracted.has(m.name); });
      }
    }
    entry.who = tiebreak(rot, entry, preferred.length ? preferred : candidates, settings);
    roster.credit(entry.who, units(a, entry.end, options));
    var inShifts = function (d) { return d === 0 ? '0' : formatScore(d / grid.period) + 'sl'; };
    if (widened !== null) {
      var shiftUnits = units(a, grid.offset(a, grid.period), options);
      var width = shiftUnits > 0 ? (widened.score - lowest) / shiftUnits : 0;
      warnings.push('tolerance widened to ' + formatScore(width) + 'sl for attract! with ' + widened.partners.join(', '));
    }
    if (pick.cross < cross && windowed.has(entry.who)) warnings.push('repel! relaxed to ' + inShifts(pick.cross));
    if (pick.distance < minDistance) warnings.push('min_distance relaxed to ' + inShifts(pick.distance));
    if (pick.repelDropped) warnings.push('repel relaxed: ' + entry.who + ' also on ' + (repelled.get(entry.who) || []).join(', '));
    warnings.forEach(function (n) { rot.warnings.push({ start: a, message: n }); });
  } else {
    rot.problems.push({ start: a, message: 'no eligible member for shift ' + formatDateTime(a) + ' to ' + formatDateTime(b) });
  }
  // The note cell is the user's: relaxations are reported in #Status only (DESIGN 6).
  entry.generated = makeRow({ type: 'shift', start: a, what: entry.who === null ? '' : entry.who });
}

function sweep(items, rots, holidays, ctx) {
  items.forEach(function (item) {
    var rot = rots[item.rot];
    if (rot.errors.length) return;
    switch (item.kind) {
      case 'row': {
        var message = applyStateRow(rot, item);
        if (message !== null) rot.errors.push(rowError(item.row, message));
        break;
      }
      case 'snapshot':
        rot.snapshotWhat = rot.roster.snapshotWhat();
        rot.scoresAtS = rot.roster.scores();
        break;
      case 'precredit':
        precredit(rot, holidays);
        break;
      case 'credit':
      case 'tail':
        if (!rot.precredited.has(item.entry)) {
          rot.roster.credit(item.entry.who, units(item.a, item.b, rot.timeline.at(item.a).unitsOptions(holidays)));
        }
        break;
      case 'slot':
        assignSlot(rot, item.entry, holidays, ctx);
        break;
    }
  });
}

function collectErrors(rots, list) {
  var out = [];
  rots.forEach(function (rot) {
    rot[list].forEach(function (e) {
      out.push({ rotation: rot.name, rowIndex: e.rowIndex === undefined ? null : e.rowIndex, start: e.start, message: e.message });
    });
  });
  return out;
}

function writable(rots) {
  return rots.filter(function (rot) { return !rot.frozen; });
}

// DESIGN 6: rows unchanged plus an error row above each offending row.
function errorOutput(rots, global, now) {
  var errors = collectErrors(rots, 'errors').concat(global.errors);
  return {
    rotations: writable(rots).map(function (rot) {
      return { name: rot.name, rows: sortRows(rot.errors.map(errorRow).concat(rot.rows)) };
    }),
    global: { rows: global.rows, errors: global.errors },
    errors: errors,
    regenerated: false,
    status: buildStatus([], [], errors, now),
  };
}

function globalError(e) {
  return { rotation: GLOBAL_TAB, rowIndex: e.rowIndex, start: e.start, message: e.message };
}

// #Global rows parsed against the rotation names: set rows for the timelines, relation rows for the sweep,
// error rows for the tab. A bad set row blocks regeneration (blocking); relation errors never do.
function prepareGlobal(rows, names) {
  var parsed = parseGlobal(rows || [], names);
  return { rows: parsed.rows, errors: parsed.errors.map(globalError), blocking: parsed.setErrors.length > 0, setRows: parsed.setRows, relationRows: parsed.relationRows };
}

// Relation state, sweep order and rotation lookup for the sweep (DESIGN 7). Rotation-tab relation rows are
// checked here against the rotation names; rejected rows and rows inside an order cycle get a non-blocking
// error row in their own tab.
function relationContext(global, rots) {
  var names = rots.map(function (r) { return r.name; });
  var byName = {};
  rots.forEach(function (rot) { byName[rot.name] = rot; });
  var entries = global.relationRows.map(function (row) { return { row: row, reader: null, names: whatNames(row) }; });
  rots.forEach(function (rot) {
    (rot.kept || []).filter(isRelationRow).forEach(function (row) {
      var message = validateRelationRow(row, names, rot.name);
      if (message !== null) rot.problems.push(rowError(row, message));
      else entries.push({ row: row, reader: rot.name, names: whatNames(row) });
    });
  });
  var relations = new Relations();
  entries.forEach(function (entry) { relations.add(entry); });
  // Only states that can be in force from the earliest snapshot on order the sweep; only one-sided rows
  // create edges, so only rotation-tab rows can form a cycle.
  var snapshots = rots.filter(function (r) { return r.S !== undefined; }).map(function (r) { return r.S; });
  var minS = snapshots.length ? Math.min.apply(null, snapshots) : -Infinity;
  var ordered = relationOrder(relations.orderEdges(minS), names);
  ordered.ignored.forEach(function (entry) {
    relations.remove(entry);
    byName[entry.reader].problems.push(rowError(entry.row, cycleMessage(entry, ordered.cyclic)));
  });
  rots.forEach(function (rot) { rot.rank = ordered.order.indexOf(rot.name); });
  return { relations: relations, byName: byName };
}

// DESIGN 5.8 autopin: every shift row starting at or before now + autopin (resolved on the grid at now) whose
// pin is empty gets the marker, on a copy so the swept rows and the status are untouched. Needs now. Shifts
// with nobody are not pinned: an unassignable slot must stay the script's so its error row comes back.
function autopinRows(rot, rows, now) {
  if (now === null || now === undefined) return rows;
  var autopin = rot.timeline.at(now).get('autopin');
  var grid = rot.timeline.gridAt(now);
  if (autopin === false || !grid) return rows;
  var limit = grid.offset(now, autopin.sign * resolveInterval(autopin.interval, grid, rot.sizeAt(now)));
  return rows.map(function (r) {
    if (r.type !== 'shift' || r.pin !== '' || r.start > limit || shiftAssignee(r) === null) return r;
    return Object.assign({}, r, { pin: autopin.marker, pinned: true });
  });
}

// Script rows go in front of the kept rows so undated comments still attach to the next kept row below them.
// No snapshot row for a rotation that has none yet and an empty roster at S (a fresh rotation whose team row
// sorts after S); a rotation that already has one keeps its replay boundary even when the roster empties.
function rotationOutput(rot, now) {
  var fresh = rot.snapshotWhat === '' && rot.previousAt === null;
  var rows = fresh ? [] : [makeRow({ type: 'snapshot', start: rot.S, what: rot.snapshotWhat })];
  rot.entries.forEach(function (e) { if (e.generated) rows.push(e.generated); });
  return { name: rot.name, rows: autopinRows(rot, sortRows(rows.concat(rot.problems.map(errorRow), rot.kept)), now) };
}

// Pure regeneration of DESIGN 5.3 to 5.8 and 7.
// input: { rotations: [{ name, rows, snapshotAt }], holidays: [dayIndex], global: #Global row objects, now, only }.
// now is optional: it dates the effective settings in the status and drives autopin (5.8); the schedule itself
// never depends on it.
// only: optional list of rotation names to regenerate; the others are swept frozen and not returned.
// Output: { rotations: [{ name, rows }], global: { rows, errors }, errors, regenerated, status }.
function regenerate(input) {
  var holidays = new Set(input.holidays || []);
  var only = input.only || null;
  var global = prepareGlobal(input.global, input.rotations.map(function (r) { return r.name; }));
  var rots = input.rotations.map(function (r, i) {
    return prepareRotation(r, i, holidays, only !== null && only.indexOf(r.name) < 0, global.setRows, input.now);
  });
  var ctx = relationContext(global, rots);
  var hasErrors = function () { return global.blocking || rots.some(function (rot) { return rot.errors.length > 0; }); };
  if (hasErrors()) return errorOutput(rots, global, input.now);
  sweep(mergeItems(rots), rots, holidays, ctx);
  if (hasErrors()) return errorOutput(rots, global, input.now);
  markUnmetRelations(rots, ctx);
  // Problems with a row (rejected relation rows) are errors in the status; unassignable slots are warnings.
  var problems = collectErrors(rots, 'problems');
  var rowProblems = problems.filter(function (p) { return p.rowIndex !== null; });
  var slotProblems = problems.filter(function (p) { return p.rowIndex === null; });
  return {
    rotations: writable(rots).map(function (rot) { return rotationOutput(rot, input.now); }),
    regenerated: true,
    global: { rows: global.rows, errors: global.errors },
    errors: problems.concat(global.errors),
    status: buildStatus(rots, collectErrors(rots, 'warnings').concat(slotProblems), rowProblems.concat(global.errors), input.now, ctx.relations),
  };
}

// ---- 50_status.js ----
// Status data and the 2D text arrays for the #Status and #All shifts tabs (DESIGN 5.8).

var STATUS_WIDTH = 17;
var STATUS_GAP = 2;
var STATUS_KEYS_WIDTH = 3;
var STATUS_SETTINGS_WIDTH = 3;
var SHIFTS_HEADER = ['start'];
var NOW_MARK = '--now--';
var MEMBER_HEADER = ['member', 'current', 'score', 'projected', 'last shift', 'next shift', 'exclusions'];

function statusInstant(min) {
  return min === null || min === undefined ? '' : formatDateTime(min);
}

function formatSettingValue(key, value) {
  if (value === null || value === undefined) return '';
  if (key === 'anchor') return formatDateTime(value);
  if (key === 'period') return formatDuration(value);
  if (typeof value === 'object') return value.text;
  return String(value);
}

// Every SETTINGS key with its effective value and source (rotation, global, default) at `at`, plus the start
// of the next set row of either layer after `at`.
function effectiveSettings(timeline, at) {
  var values = timeline.at(at).values;
  var sources = timeline.sourcesAt(at);
  var next = null;
  timeline.entries.forEach(function (e) { if (e.start > at && next === null) next = e.start; });
  return {
    at: at,
    values: Object.keys(SETTINGS).map(function (key) {
      return { key: key, value: formatSettingValue(key, values[key]), source: sources[key] };
    }),
    nextSetAt: next,
  };
}

function shiftRef(entry) {
  return entry ? { who: entry.who === null ? '' : entry.who, start: entry.start, end: entry.end } : null;
}

// rot: swept rotation internals from 40_scheduler.js (roster, scoresAtS, entries, S, horizonEnd, timeline).
// now: run instant for the settings block and the current/next shift; S when absent.
function rotationStatus(rot, now) {
  var projected = rot.roster.scores();
  var S = rot.S;
  var at = now === null || now === undefined ? S : now;
  var current = null, upcoming = null;
  rot.entries.forEach(function (e) {
    if (e.start <= at && e.end > at) current = e;
    else if (e.start > at && upcoming === null) upcoming = e;
  });
  return {
    name: rot.name,
    snapshotAt: S,
    previousAt: rot.previousAt,
    horizonEnd: rot.horizonEnd,
    current: shiftRef(current),
    next: shiftRef(upcoming),
    settings: effectiveSettings(rot.timeline, at),
    roster: rot.roster.members.map(function (m) {
      var last = null, next = null;
      rot.entries.forEach(function (e) {
        if (e.who !== m.name) return;
        if (e.start <= S) last = e.start;
        else if (next === null) next = e.start;
      });
      return {
        name: m.name,
        score: rot.scoresAtS[m.name] === undefined ? null : rot.scoresAtS[m.name],
        projected: projected[m.name],
        lastShift: last,
        nextShift: next,
        exclusions: m.exclusions
          .filter(function (ex) { return ex.from <= S && (ex.to === null || ex.to > S); })
          .map(function (ex) { return { from: ex.from, to: ex.to }; }),
      };
    }),
  };
}

// Every shift of every rotation with its scored extent and the relations it does not meet (7), by start then
// rotation order. who is '' for a nobody shift.
function shiftsView(rots) {
  var out = [];
  rots.forEach(function (rot) {
    rot.entries.forEach(function (e) {
      out.push({ start: e.start, end: e.end, rotation: rot.name, who: e.who === null ? '' : e.who, unmet: e.unmet || [] });
    });
  });
  return out.sort(function (a, b) { return a.start - b.start; });
}

// Pair states in force at `at`: { reader, target, kind } for every ordered pair, mutual states twice.
function relationsView(rots, relations, at) {
  var out = [];
  if (!relations || at === null) return out;
  var names = rots.map(function (r) { return r.name; });
  names.forEach(function (reader) {
    names.forEach(function (target) {
      if (reader === target) return;
      var kind = relations.kindFor(reader, target, at);
      if (kind !== null) out.push({ reader: reader, target: target, kind: kind });
    });
  });
  return out;
}

// rots: swept rotations, or [] when a validation error stopped the run. now: optional run instant.
// relations: the Relations of the sweep, or null.
function buildStatus(rots, warnings, errors, now, relations) {
  var at = now === null || now === undefined ? null : now;
  return {
    at: at,
    rotations: rots.map(function (rot) { return rotationStatus(rot, now); }),
    relations: relationsView(rots, relations, at),
    warnings: warnings,
    errors: errors,
    shifts: shiftsView(rots),
  };
}

function padCells(cells, width) {
  return cells.concat(new Array(Math.max(0, width - cells.length)).fill(''));
}

function padStatusRow(cells) {
  return padCells(cells, STATUS_WIDTH);
}

function formatExclusions(list) {
  return list.map(function (ex) {
    return statusInstant(ex.from) + ' to ' + (ex.to === null ? 'open' : statusInstant(ex.to));
  }).join('; ');
}

// Column groups side by side: each padded to its width and to the tallest group, STATUS_GAP empty columns between.
function sideBySide(groups) {
  var height = Math.max.apply(null, groups.map(function (g) { return g.rows.length; }));
  var out = [];
  for (var i = 0; i < height; i++) {
    var row = [];
    groups.forEach(function (g, k) {
      if (k > 0) row = row.concat(new Array(STATUS_GAP).fill(''));
      row = row.concat(padCells(g.rows[i] || [], g.width));
    });
    out.push(row);
  }
  return out;
}

// One rotation as three groups of rows: key/value rows, member table, settings table (DESIGN 5.8).
function rotationGroups(rot) {
  var keys = [
    ['rotation', rot.name],
    ['snapshot', statusInstant(rot.snapshotAt)],
    ['horizon', statusInstant(rot.horizonEnd)],
    ['current', rot.current ? rot.current.who : '', rot.current ? 'until ' + statusInstant(rot.current.end) : ''],
    ['next', rot.next ? rot.next.who : '', rot.next ? 'from ' + statusInstant(rot.next.start) : ''],
  ];
  var members = [MEMBER_HEADER.slice()].concat(rot.roster.map(function (m) {
    return [m.name, rot.current && rot.current.who === m.name ? 'x' : '',
      m.score === null ? '' : formatScore(m.score), formatScore(m.projected),
      statusInstant(m.lastShift), statusInstant(m.nextShift), formatExclusions(m.exclusions)];
  }));
  var settings = [['settings', 'as of ' + statusInstant(rot.settings.at), 'source']].concat(
    rot.settings.values.map(function (s) { return [s.key, s.value, s.source]; }));
  if (rot.settings.nextSetAt !== null) settings.push(['note', 'a set row at ' + statusInstant(rot.settings.nextSetAt) + ' changes these values']);
  return { keys: keys, members: members, settings: settings };
}

// Spreadsheet arrangement: the three groups side by side, first row is the header of all three.
function horizontalBlock(rot) {
  var g = rotationGroups(rot);
  var rows = sideBySide([
    { rows: g.keys, width: STATUS_KEYS_WIDTH },
    { rows: g.members, width: MEMBER_HEADER.length },
    { rows: g.settings, width: STATUS_SETTINGS_WIDTH },
  ]);
  return { rows: rows, headers: [0] };
}

// CLI arrangement: the groups one after another, tables indented by one cell, each group's first row a header.
function verticalBlock(rot) {
  var g = rotationGroups(rot);
  var indent = function (row) { return [''].concat(row); };
  var rows = g.keys.concat([[]], g.members.map(indent), [[]], g.settings.map(indent));
  return { rows: rows, headers: [0, g.keys.length + 1, g.keys.length + g.members.length + 2] };
}

// Relations matrix rows: header with every rotation, then per reader a row with + (attract), +! (attract!),
// - (repel) or -! (repel!).
function relationsMatrix(status) {
  var names = status.rotations.map(function (r) { return r.name; });
  var marks = { attract: '+', 'attract!': '+!', repel: '-', 'repel!': '-!' };
  var rows = [['Relations'].concat(names)];
  names.forEach(function (reader) {
    rows.push([reader].concat(names.map(function (target) {
      var rel = status.relations.find(function (r) { return r.reader === reader && r.target === target; });
      return rel ? marks[rel.kind] || '' : '';
    })));
  });
  return rows;
}

// Rows of the #Status tab plus presentation metadata: headerRows, dividerRows, errorRows and warningRows are
// row indexes for the adapter to format (the errors and warnings tables and the same rows of extension
// blocks). status.now, status.mode and status.tabs are set by the runner. block: horizontalBlock
// for the spreadsheet, verticalBlock for the CLI. Extension blocks (<prefix>_status(status) returning
// { rows, headerRows }) follow the frame, each after a blank row, their rows cut to STATUS_WIDTH; a hook that
// throws adds an entry to the errors block instead.
function statusRowsWith(status, block) {
  var rows = [];
  var headerRows = [];
  var errorRows = [];
  var warningRows = [];
  var push = function (cells) { rows.push(padStatusRow(cells.slice(0, STATUS_WIDTH))); };
  var header = function (cells) { headerRows.push(rows.length); push(cells); };
  var marked = function (cells, list) { list.push(rows.length); push(cells); };
  var errors = status.errors.slice();
  var blocks = [];
  callExtensionHooks('status', [status], function (h, e) { errors.push(extensionError(h, e)); }).forEach(function (r) {
    if (r.value && Array.isArray(r.value.rows) && r.value.rows.length) blocks.push(r.value);
  });
  header(['Rotalator', status.mode || '', status.now || '']);
  if (status.tabs) {
    push([]);
    header(['Tabs']);
    push(['rotations', status.tabs.rotations.join(', ')]);
    push(['regenerated', status.tabs.regenerated.join(', ')]);
    push(['holidays', String(status.tabs.holidays)]);
    push(['global', String(status.tabs.global)]);
    push(['ignored', status.tabs.ignored.join(', ')]);
  }
  if (status.rotations.length > 1 && (status.relations || []).length) {
    push([]);
    relationsMatrix(status).forEach(function (row, i) { if (i === 0) header(row); else push(row); });
  }
  status.rotations.forEach(function (rot) {
    push([]);
    var b = block(rot);
    b.rows.forEach(function (row, i) { if (b.headers.indexOf(i) >= 0) header(row); else push(row); });
  });
  if (status.warnings.length) {
    push([]);
    header(['warnings']);
    header(['rotation', 'start', 'message']);
    status.warnings.forEach(function (w) { marked([w.rotation, statusInstant(w.start), w.message], warningRows); });
  }
  if (errors.length) {
    push([]);
    header(['errors']);
    header(['rotation', 'where', 'message']);
    errors.forEach(function (e) {
      var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex : statusInstant(e.start);
      marked([e.rotation, where, e.message], errorRows);
    });
  }
  blocks.forEach(function (table) {
    push([]);
    table.rows.forEach(function (row, i) {
      var at = rows.length;
      if ((table.headerRows || [0]).indexOf(i) >= 0) header(row); else push(row);
      if ((table.errorRows || []).indexOf(i) >= 0) errorRows.push(at);
      if ((table.warningRows || []).indexOf(i) >= 0) warningRows.push(at);
    });
  });
  return { rows: rows, headerRows: headerRows, dividerRows: [], errorRows: errorRows, warningRows: warningRows };
}

function statusRows(status) {
  return statusRowsWith(status, horizontalBlock);
}

function statusRowsVertical(status) {
  return statusRowsWith(status, verticalBlock);
}

// Rows of the #All shifts grid: header start | <rotation> ..., one row per distinct shift start with the
// assignee starting then in each rotation's column ('-' for nobody), and a now row marked in every rotation
// column after any row with the same start. currentCells [{ row, col }] (0-based) are the cells of each
// rotation's shift covering now; both are empty when status.at is unknown. errorCells [{ row, col, note }]
// are the shifts that break a relation in force (7), the note naming each relation and partner.
function shiftsRows(status) {
  var names = status.rotations.map(function (r) { return r.name; });
  var rows = [SHIFTS_HEADER.concat(names)];
  var dividerRows = [];
  var currentCells = [];
  var errorCells = [];
  var unmetAt = new Map();
  var at = status.at;
  var known = at !== null && at !== undefined;
  var current = {};
  if (known) status.rotations.forEach(function (r) { if (r.current) current[r.name] = r.current.start; });
  var starts = [];
  var byStart = new Map();
  status.shifts.forEach(function (s) {
    if (!byStart.has(s.start)) { byStart.set(s.start, {}); starts.push(s.start); }
    byStart.get(s.start)[s.rotation] = s.who === '' ? '-' : s.who;
    if (s.unmet && s.unmet.length) unmetAt.set(s.start + '|' + s.rotation, s.unmet.map(function (u) { return u.relation + ' with ' + u.rotation; }).join('; '));
  });
  var nowRow = [statusInstant(at)].concat(names.map(function () { return NOW_MARK; }));
  var placed = !known;
  starts.forEach(function (start) {
    if (!placed && start > at) { dividerRows.push(rows.length); rows.push(nowRow); placed = true; }
    var cells = byStart.get(start);
    names.forEach(function (n, i) {
      if (current[n] === start) currentCells.push({ row: rows.length, col: i + 1 });
      var note = unmetAt.get(start + '|' + n);
      if (note) errorCells.push({ row: rows.length, col: i + 1, note: note });
    });
    rows.push([statusInstant(start)].concat(names.map(function (n) { return cells[n] || ''; })));
  });
  if (!placed) { dividerRows.push(rows.length); rows.push(nowRow); }
  return { rows: rows, headerRows: [0], dividerRows: dividerRows, currentCells: currentCells, errorCells: errorCells };
}

// ---- 60_relations.js ----
// #Global tab (DESIGN 3.5 and 7): spreadsheet-wide set rows, relation rows between rotations, and comments.
// Relation rows (attract, attract!, repel, repel!, detach) also appear in rotation tabs, where they are
// one-sided.

var RELATION_TYPES = ['attract', 'attract!', 'repel', 'repel!', 'detach'];

function isRelationRow(row) {
  return RELATION_TYPES.indexOf(row.type) >= 0;
}

// Relation-specific checks. reader: the rotation whose tab holds the row, null for #Global.
function validateRelationRow(row, rotationNames, reader) {
  var names = whatNames(row);
  if (new Set(names).size !== names.length) return row.type + ' names a rotation twice';
  if (reader === null && names.length < 2) return row.type + ' in ' + GLOBAL_TAB + ' needs at least two rotations';
  for (var i = 0; i < names.length; i++) {
    if (names[i] === reader) return row.type + ' names its own rotation';
    if (rotationNames.indexOf(names[i]) < 0) return 'unknown rotation "' + names[i] + '"';
  }
  return null;
}

// rows: #Global row objects. Returns { setRows, setErrors, relationRows, errors, rows } where rows are the kept
// rows plus an error row above each rejected one. set rows are validated with the ledger rules; a bad one is in
// setErrors and blocks regeneration since every rotation depends on it. Rejected relation rows are ignored.
// Comments are kept and otherwise ignored.
function parseGlobal(rows, rotationNames) {
  var errors = [];
  var setErrors = [];
  var setRows = [];
  var relationRows = [];
  var kept = sortRows(attachComments(rows.filter(function (r) { return r.type !== 'error'; })));
  kept.forEach(function (row) {
    if (row.type === 'comment') return;
    if (row.type === 'set') {
      var problem = validateRow(row);
      if (problem === null) setRows.push(row); else setErrors.push(rowError(row, problem));
      return;
    }
    var message = !isRelationRow(row) ? (row.type === '' ? 'missing type' : 'type "' + row.type + '" is not allowed in ' + GLOBAL_TAB)
      : validateRow(row) || validateRelationRow(row, rotationNames, null);
    if (message === null && row.durationInterval && row.durationInterval.unit !== 'clock') message = 'duration in ' + GLOBAL_TAB + ' takes clock units only';
    if (message === null) relationRows.push(row); else errors.push(rowError(row, message));
  });
  var all = setErrors.concat(errors);
  return { setRows: setRows, setErrors: setErrors, relationRows: relationRows, errors: all, rows: sortRows(all.map(errorRow).concat(kept)) };
}

function pairKey(a, b) {
  return a < b ? a + '\u0000' + b : b + '\u0000' + a;
}

// Pair states over time. Each relation row sets the state of every pair it names from its start (latest row
// wins, ties by processing order) and reverts it to neutral at its end. reader null means mutual; two tabs
// starting the same one-sided relation on each other at the same instant make the pair mutual.
class Relations {
  constructor() {
    this.events = new Map();
  }

  // entry: { row, reader, names }. Pairs: all pairs of names for #Global, (reader, name) for a rotation tab.
  add(entry) {
    var self = this;
    var kind = entry.row.type === 'detach' ? null : entry.row.type;
    var pairs = [];
    if (entry.reader === null) {
      entry.names.forEach(function (a, i) { entry.names.slice(i + 1).forEach(function (b) { pairs.push([a, b]); }); });
    } else {
      entry.names.forEach(function (b) { pairs.push([entry.reader, b]); });
    }
    pairs.forEach(function (p) {
      var key = pairKey(p[0], p[1]);
      if (!self.events.has(key)) self.events.set(key, []);
      var list = self.events.get(key);
      var opposite = list.find(function (e) {
        return e.starts === 1 && e.t === entry.row.start && e.kind === kind && e.reader !== null && e.reader === p[1] && entry.reader !== null;
      });
      if (opposite) { opposite.reader = null; opposite.target = null; }
      else list.push({ t: entry.row.start, starts: 1, seq: list.length, kind: kind, reader: entry.reader, target: p[1], entry: entry });
      if (entry.row.end !== null) list.push({ t: entry.row.end, starts: 0, seq: list.length, kind: null, reader: null, target: null, entry: entry });
    });
  }

  remove(entry) {
    this.events.forEach(function (list, key, map) {
      map.set(key, list.filter(function (e) { return e.entry !== entry; }));
    });
  }

  // Ends sort before starts at equal instants; later-added rows win among starts.
  sorted(list) {
    return list.slice().sort(function (x, y) { return (x.t < y.t ? -1 : x.t > y.t ? 1 : 0) || (x.starts - y.starts) || (x.seq - y.seq); });
  }

  // { kind, reader } in force between a and b at t, or null.
  stateAt(a, b, t) {
    var list = this.events.get(pairKey(a, b));
    if (!list) return null;
    var sorted = this.sorted(list);
    var state = null;
    for (var i = 0; i < sorted.length && sorted[i].t <= t; i++) state = sorted[i].kind === null ? null : sorted[i];
    return state;
  }

  // The kind reader is subject to towards other at t: a mutual state, or a one-sided one it holds itself.
  kindFor(reader, other, t) {
    var state = this.stateAt(reader, other, t);
    if (!state || (state.reader !== null && state.reader !== reader)) return null;
    return state.kind;
  }

  // Order edges { from, to, entry } (from is decided before to) of the one-sided states that are or will be in
  // force from t on: per pair the last event at or before t and every event after it. Mutual states add none.
  orderEdges(t) {
    var edges = [];
    var self = this;
    this.events.forEach(function (list) {
      var sorted = self.sorted(list);
      var from = 0;
      for (var i = 0; i < sorted.length; i++) if (sorted[i].t <= t) from = i;
      for (var j = from; j < sorted.length; j++) {
        var e = sorted[j];
        if (e.kind !== null && e.reader !== null) edges.push({ from: e.target, to: e.reader, entry: e.entry });
      }
    });
    return edges;
  }
}

// Kahn's algorithm with tab order as tiebreak. Returns { order, rest } where rest holds the rotations left in
// cycles (and those only reachable through them).
function topologicalOrder(edges, rotationNames) {
  var pending = edges.slice();
  var order = [];
  var rest = rotationNames.slice();
  var progress = true;
  while (progress) {
    progress = false;
    for (var i = 0; i < rest.length; i++) {
      var name = rest[i];
      if (pending.some(function (e) { return e.to === name; })) continue;
      order.push(name);
      rest.splice(i, 1);
      pending = pending.filter(function (e) { return e.from !== name; });
      progress = true;
      break;
    }
  }
  return { order: order, rest: rest };
}

// Rotations inside dependency cycles: what remains after repeatedly dropping sources and sinks. A rotation on
// a path between two cycles is included too.
function cyclicRotations(edges, rotationNames) {
  var nodes = rotationNames.slice();
  var changed = true;
  while (changed) {
    changed = false;
    nodes = nodes.filter(function (n) {
      var hasIn = edges.some(function (e) { return e.to === n && nodes.indexOf(e.from) >= 0; });
      var hasOut = edges.some(function (e) { return e.from === n && nodes.indexOf(e.to) >= 0; });
      if (hasIn && hasOut) return true;
      changed = true;
      return false;
    });
  }
  return nodes;
}

// Sweep order at equal starts (DESIGN 7): every rotation after the rotations it reads, then tab order. Entries
// whose edges lie inside a cycle are returned in `ignored`; the order is computed without them.
function relationOrder(edges, rotationNames) {
  var cyclic = cyclicRotations(edges, rotationNames);
  var ignored = [];
  var kept = edges.filter(function (e) {
    var inCycle = cyclic.indexOf(e.from) >= 0 && cyclic.indexOf(e.to) >= 0;
    if (inCycle && ignored.indexOf(e.entry) < 0) ignored.push(e.entry);
    return !inCycle;
  });
  var result = topologicalOrder(kept.filter(function (e) { return ignored.indexOf(e.entry) < 0; }), rotationNames);
  return { order: result.order.concat(result.rest), ignored: ignored, cyclic: cyclic };
}

function cycleMessage(entry, cyclic) {
  var others = cyclic.filter(function (n) { return n !== entry.reader; });
  return 'relation order cycle among ' + others.join(', ') + '; use a ' + GLOBAL_TAB + ' row';
}

// Adds to `holders` (Map member -> rotation names) the members holding a decided shift of `target`
// overlapping [from, to).
function addHolders(holders, target, from, to) {
  target.entries.forEach(function (e) {
    if (e.who === null || e.start >= to || e.end <= from) return;
    if (!holders.has(e.who)) holders.set(e.who, []);
    if (holders.get(e.who).indexOf(target.name) < 0) holders.get(e.who).push(target.name);
  });
}

// Members holding a decided shift overlapping [a, b) in rotations that `kind` applies to for rot at a.
function relatedHolders(ctx, rot, kind, a, b) {
  var holders = new Map();
  Object.keys(ctx.byName).forEach(function (other) {
    var target = ctx.byName[other];
    if (target !== rot && ctx.relations.kindFor(rot.name, other, a) === kind) addHolders(holders, target, a, b);
  });
  return holders;
}

// repel! partners of rot at a with the pair's rest window in minutes: D = (D_rot + D_partner) / 2, each
// min_distance resolved in its own grid space with its roster at a (DESIGN 7). localDistance: D_rot.
function strongPartners(ctx, rot, a, localDistance) {
  var partners = [];
  Object.keys(ctx.byName).forEach(function (other) {
    var target = ctx.byName[other];
    if (target === rot || ctx.relations.kindFor(rot.name, other, a) !== 'repel!') return;
    var grid = target.timeline.gridAt(a);
    var theirs = grid ? resolveInterval(target.timeline.at(a).get('min_distance'), grid, target.roster.size()) : 0;
    partners.push({ rot: target, distance: (localDistance + theirs) / 2 });
  });
  return partners;
}

// Whether `who` holds a decided shift of rot overlapping [from, to).
function holdsOverlapping(rot, who, from, to) {
  return rot.entries.some(function (e) { return e.who === who && e.start < to && e.end > from; });
}

// Whether `who` could hold a shift [a, b) of rot: on its roster at a and not excluded then.
function couldHold(rot, who, a, b) {
  return rot.namesAt(a).indexOf(who) >= 0 && !rot.roster.isExcluded(who, a, b);
}

// Marks every decided shift of every rotation with the relations in force at its start that it does not meet
// (DESIGN 7, Unmet relations): e.unmet = [{ relation, rotation }], for the #All shifts view. The reader's own
// cell is marked (mutual states on both sides). repel and repel!: the holder also holds an overlapping shift
// in the partner (the rest window of repel! is not checked); attract and attract!: the partner's overlapping
// shift is held by someone else who could hold this one while this holder could hold the partner's, so a
// vacation on either side does not count. Nobody shifts are never marked.
function markUnmetRelations(rots, ctx) {
  rots.forEach(function (rot) {
    if (rot.errors.length || !rot.entries) return;
    rot.entries.forEach(function (e) {
      e.unmet = [];
      if (e.who === null) return;
      var a = e.start, b = e.end;
      Object.keys(ctx.byName).forEach(function (other) {
        var target = ctx.byName[other];
        if (target === rot || !target.entries) return;
        var kind = ctx.relations.kindFor(rot.name, other, a);
        if (kind === null) return;
        var unmet = false;
        if (kind === 'repel' || kind === 'repel!') {
          unmet = holdsOverlapping(target, e.who, a, b);
        } else if (kind === 'attract' || kind === 'attract!') {
          unmet = target.entries.some(function (t) {
            return t.who !== null && t.who !== e.who && t.start < b && t.end > a && couldHold(rot, t.who, a, b) && couldHold(target, e.who, a, b);
          });
        }
        if (unmet) e.unmet.push({ relation: kind, rotation: other });
      });
    });
  });
}

// Members repelled from slot [a, b) of rot: holders of overlapping shifts in plain repel partners, and holders
// of shifts in repel! partners overlapping the slot widened by the pair's window less `shrink` (never below
// zero) along rot's grid. Map member -> rotation names.
function repelledHolders(ctx, rot, a, b, grid, partners, shrink) {
  var holders = relatedHolders(ctx, rot, 'repel', a, b);
  partners.forEach(function (p) {
    var d = Math.max(p.distance - shrink, 0);
    addHolders(holders, p.rot, grid.offset(a, -d), grid.offset(b, d));
  });
  return holders;
}

// ---- 70_tools.js ----
// Row logic behind the Set up, Template and Fill Shifts Grid tools (DESIGN 10). Pure; adapters read and write cells.

var TEMPLATE_TEAM = 'alice, bob, carol';
var TEMPLATE_PERIOD = '1w';
var HOLIDAYS_HEADER = ['date', 'note'];

var COLUMN_NOTES = {
  pin: 'Any non-empty value pins the row: the script never modifies or deletes it. A ticked checkbox works too.',
  start: 'YYYY-MM-DDTHH:MM in the spreadsheet time zone. Mandatory. Keep the column as plain text.',
  type: 'shift, team, join, leave, exclude, include, score, set. The script writes snapshot and error rows.',
  what: 'Payload of the row: one member for shift; a list for team, join, leave, exclude, include, score; key=value settings for set.',
  end: 'YYYY-MM-DDTHH:MM. Optional. Not together with duration.',
  duration: '1w, 3d, 12h, 1d12h, 0.5d, 2sl (shift lengths), 1ts (team size x shift length). Optional. Not together with end.',
  note: 'Free text, yours: the script never writes into it, and generated shifts have an empty note.',
  date: 'YYYY-MM-DD, one holiday per row. Counted by rotations with skip_holidays=true.',
};

// Most recent Monday 00:00 at or before t.
function recentMonday(t) {
  var day = dayIndex(t);
  return dayStart(day - (weekdayOfDay(day) + 6) % 7);
}

// Every setting spelled out at its default: period=1w, the rest key=default; anchor is left to the dated row
// and a key with an empty default (cal) has nothing to spell.
function templateSetWhat() {
  return Object.keys(SETTINGS).filter(function (key) { return key !== 'anchor' && SETTINGS[key].def !== ''; }).map(function (key) {
    if (key === 'period') return 'period=' + TEMPLATE_PERIOD;
    var def = SETTINGS[key].def;
    return key + '=' + (def !== null && typeof def === 'object' ? def.text : String(def));
  }).join(', ');
}

// In-tab help: undated comment rows (text in note) that attach to the set row below them and stay on top.
var ROTATION_HELP = [
  'ROWS:',
  'shift: one member, or nobody',
  'team / score: name, name=baseline, name=number, name+=n, name-=n [, ...]',
  'join: name, name=baseline, name=number [, ...]',
  'leave: name [, name ...]',
  'exclude / include: name [, name ...]',
  'set: key, key=value',
  'set / team without start: take the date of the nearest dated row above, or apply from the beginning at the top; the dated set anchor row fixes where shifts start',
];
var GLOBAL_HELP = [
  'ROWS:',
  'repel / repel! / attract / attract! / detach: Rotation1, Rotation2',
  'set: key, key=value',
  'set / repel / repel! / attract / attract! without start: take the date of the nearest dated row above, or apply from the beginning at the top',
];
var HOLIDAYS_SAMPLE_NOTE = 'New Year';

// The #Help tab, one line per row (DESIGN 10.1). Written in full by Set Up Spreadsheet.
var HELP_TEXT = [
  'ROTALATOR',
  'Rotalator keeps on-call rotations topped up in this spreadsheet. You edit the rotation tabs; the script runs nightly or from the Rotalator menu, replays the history and rewrites the future so that on-call load stays fair. Unpinned shifts after the snapshot row belong to the script and are regenerated on every run.',
  '',
  'COLUMNS: pin | start | type | what | end | duration | note',
  'pin: any value pins the row; the script never modifies or deletes a pinned row',
  'start: YYYY-MM-DD or YYYY-MM-DDTHH:MM in the spreadsheet time zone; mandatory except on comments and on set, team, repel, repel!, attract and attract! rows that apply from the beginning',
  'type: one of the row types below; an empty type makes the row a comment',
  'what: the payload of the row, see ROWS',
  'end / duration: optional extent of a shift or exclude; at most one of the two',
  'note: free text, yours; the script never writes into it, and generated shifts have an empty note',
  '',
  'ROWS:',
  'shift: one member, or nobody (empty, - or none)',
  'team / score: name, name=baseline, name=number, name+=n, name-=n [, ...]',
  'join: name, name=baseline, name=number [, ...]',
  'leave: name [, name ...]',
  'exclude / include: name [, name ...]; exclude takes end or duration, otherwise it lasts until an include',
  'set: key, key=value',
  'undated set / team / repel / repel! / attract / attract!: take the date of the nearest dated row above them, or apply from the beginning of the timeline when nothing dated is above; anchor needs a dated set row',
  'undated row at the bottom of the tab: it takes the date of the last generated shift near the horizon, not today; type it under the current shift instead',
  'repel / repel! / attract / attract! / detach: Rotation1, Rotation2 (mutual in #Global; in a rotation tab one-sided, naming the other rotation)',
  'snapshot: written by the script at the start of the current shift with the roster and scores; delete it to replay the whole history',
  'error: written by the script above the row it describes; removed on the next run',
  'comment: any row with an empty type; kept in place, never replayed; an undated comment sticks to the row below it',
  '',
  'SETTINGS (set rows; a bare key drops the local value, falling back to #Global and then to the default):',
  'period=1w: regular shift length in clock units; required in the first set row of a rotation',
  'anchor: bare key, the row start becomes the grid anchor; every shift starts at anchor + k x period',
  'grid=calendar: or counted, a boundary every period of counted (not skipped) days',
  'horizon=20w: generate shifts up to this interval after the snapshot',
  'skip_weekends=true: Saturdays and Sundays credit nothing',
  'skip_holidays=true: dates listed in #Holidays credit nothing',
  'tolerance=0.5sl: days (or an interval) above the lowest score that still count as candidates',
  'min_distance=0.5ts: rest required on both sides of a shift, as an interval',
  'tiebreak=order: or shuffle (deterministic hash with seed)',
  'seed=0: integer mixed into the shuffle',
  'baseline=median: score given to a joiner: median, mean, min or max of the roster',
  'precredit=1ts: how far ahead pinned shifts are credited before turns are decided',
  'autopin=a:2sl: after each run, shifts starting up to now + this interval get the pin marker a (false: never; a:2w sets the marker); pinned shifts are kept, so this fixes the near future',
  'cal: space-separated names of calendar presets from the #GCal tab (cal=team backup); exported by the GCal extension, a warning in #Status when it is not installed',
  'slack: space-separated names of Slack presets from the #Slack tab (slack=team heads-up); posted by the Slack extension, a warning in #Status when it is not installed',
  '',
  'INTERVALS (duration, horizon, min_distance, precredit, tolerance):',
  'clock units w d h m; one token may be fractional (1.5w, 0.5d), integer tokens chain from large to small (1d12h)',
  'sl: one shift length, the period in force; ts: team size x shift length, one full cycle of the roster (0.5ts, 2sl)',
  '0 is the zero interval; with grid=counted intervals count counted days, so 2d is two working days',
  '',
  'RELATIONS between rotations (rows in #Global, or one-sided in a rotation tab):',
  'repel: nobody holds overlapping shifts in both rotations; repel!: also keeps a member off the other rotation for half the combined min_distance before and after their shift; attract: prefer the member already on call in the other rotation when within tolerance; attract!: also widen the tolerance up to one team round to follow them; detach: ends an earlier relation',
  '',
  'MENU:',
  'Run: regenerates every rotation and rewrites #Status and #All shifts (a red cell there is a shift that breaks a relation in force; its note names the relation and the other rotation); the nightly trigger runs this',
  'Run - preview: writes #Preview <rotation> tabs instead of the ledgers, plus #Status and #All shifts; #Global is read but not written',
  'Run for current rotation / Run for current rotation - preview: the same for the active tab only',
  'Abort run: asks the run in progress to stop its calendar export or clean at the next event; one run at a time holds the script lock, others wait 5 s and give up',
  'Set Up Spreadsheet: creates missing tabs, formats every tab and rewrites #Help; never changes your data',
  'Set Up Tab: fills an empty tab from its template (rotation, #Holidays or #Global)',
  'Fill Shifts Grid: puts the selected rows of a rotation tab on the grid, filling start',
  'Install nightly trigger / Remove trigger: schedule Run daily between 02:00 and 03:00, or stop it',
  '',
  'NEVER TOUCHED BY THE SCRIPT: pinned rows; rows before the stored snapshot; comments; header rows; tabs without the ledger header. Unpinned shifts after the snapshot are regenerated every run.',
  '',
  'ONE GRID STEP: a shift without end or duration ends at the earlier of the next shift start and the next grid boundary, so it counts as at most one period. Give hand-entered history that spans several periods a duration or an end.',
  '',
  'MORE: MANUAL.md (features and everyday tasks) and INSTALL.md (setup, deployment, troubleshooting) in the Rotalator repository.',
];

// The #Help lines: HELP_TEXT followed by the lines each installed extension returns from <prefix>_help(lines)
// (DESIGN 8, Extensions); a hook that throws or returns no array adds nothing.
function helpText() {
  var lines = HELP_TEXT.slice();
  callExtensionHooks('help', [HELP_TEXT.slice()]).forEach(function (r) {
    if (Array.isArray(r.value)) lines = lines.concat(r.value.map(String));
  });
  return lines;
}

// 0-based indexes of the help lines (HELP_TEXT by default) written bold: the first line and every heading, a
// line ending with ':'.
function helpHeadingRows(lines) {
  var out = [];
  (lines || HELP_TEXT).forEach(function (line, i) { if (i === 0 || /:$/.test(line)) out.push(i); });
  return out;
}

function helpRows(lines) {
  return lines.map(function (text) { return ['', '', '', '', '', '', text]; });
}

// Header, help rows and an undated (epoch) set row with every setting at its default for a new #Global tab.
function globalTemplateRows() {
  return [LEDGER_HEADER.slice()].concat(helpRows(GLOBAL_HELP), [['', '', 'set', templateSetWhat(), '', '', '']]);
}

// Header plus one sample holiday: New Year of the calendar year before `now`.
function holidaysTemplateRows(now) {
  var year = Number(formatDateTime(now).slice(0, 4)) - 1;
  return [HOLIDAYS_HEADER.slice(), [String(year).padStart(4, '0') + '-01-01', HOLIDAYS_SAMPLE_NOTE]];
}

// Header, help rows, an epoch set row with every default, an epoch team row and one dated set anchor row at
// firstStart, for a new rotation tab.
function templateRows(firstStart) {
  return [LEDGER_HEADER.slice()].concat(helpRows(ROTATION_HELP), [
    ['', '', 'set', templateSetWhat(), '', '', ''],
    ['', '', 'team', TEMPLATE_TEAM, '', '', ''],
    ['', formatDateTime(firstStart), 'set', 'anchor', '', '', ''],
  ]);
}

function previousBoundary(grid, t) {
  var b = grid.floor(t);
  return b < t ? b : grid.offset(b, -grid.period);
}

function emptyShiftRow(start) {
  return makeRow({ type: 'shift', start: start });
}

// Grid at t, or the first grid of the timeline for instants before its first set row.
function gridFor(timeline, t) {
  return timeline.gridAt(t) || timeline.gridAt(timeline.entries[0].start);
}

// DESIGN 10: dated rows sorted; between the first row and the later of the last shift claim end and the last
// row start, every uncovered boundary and gap start gets an empty shift row; nPre boundaries before the first
// row and nPost rows from the tail on. rows: dated row objects at or after the timeline's first set row.
function gridRows(rows, nPre, nPost, timeline) {
  var sorted = sortRows(rows);
  var dated = sorted.filter(function (r) { return r.start !== null && isFinite(r.start); });
  if (!dated.length) return sorted;
  var changes = timeline.gridChanges();
  var shifts = rowsOfType(sorted, 'shift');
  var claims = shifts.map(function (s, i) {
    return [s.start, claimEnd(s, shifts[i + 1] ? shifts[i + 1].start : null, timeline.gridAt(s.start), changes)];
  });
  var first = dated[0].start;
  var lastStart = dated[dated.length - 1].start;
  var claimsEnd = claims.length ? claims[claims.length - 1][1] : first;
  var regionEnd = Math.max(claimsEnd, lastStart);

  var out = [];
  var slots = [];
  uncoveredSpans(first, regionEnd, claims).forEach(function (span) { splitSlots(span[0], span[1], timeline, changes, slots); });
  slots.forEach(function (slot) { out.push(emptyShiftRow(slot.start)); });

  var t = first;
  for (var i = 0; i < nPre; i++) {
    t = previousBoundary(gridFor(timeline, t), t);
    out.push(emptyShiftRow(t));
  }
  // The tail starts at a mid-period claim end (a gap start) or at the boundary at or after the last row.
  t = Math.max(claimsEnd, timeline.gridAt(lastStart).ceil(lastStart));
  for (var j = 0; j < nPost; j++) {
    out.push(emptyShiftRow(t));
    t = timeline.gridAt(t).next(t);
  }
  // New rows go in front so undated comments keep attaching to the selected row below them.
  return sortRows(out.concat(sorted));
}

// An undated selection row counts as an empty grid position when it is blank or carries type=shift and
// nothing else; an undated comment travels with the next dated row; an undated set/team/relation row takes
// the date of the nearest dated selected row above it (3.4), or stays in front when there is none.
function isTemplateShiftRow(cells) {
  return cells.every(function (c, i) { return i === 2 ? cellText(c).toLowerCase() === 'shift' : cellText(c) === ''; });
}

// A dated row with nothing but its start (and pin) is a grid position, not a comment.
function hasOnlyStart(cells) {
  return cells.every(function (c, i) { return i === 0 || i === 1 || cellText(c) === ''; });
}

// Fill Shifts Grid over a selection. selectedCells: the ledger columns of the selected rows; tabCells: every
// row of the tab below the header, for the settings timeline; holidayTexts: #Holidays column A; globalCells:
// #Global rows below the header, for global set rows; topIndex: index in tabCells of the first selected row,
// so an undated set/team/relation row at the top of the selection takes its date from the tab rows above it,
// as the run would (3.4). Returns { rows: cell arrays } or { error: message }. Dated comments stay in place;
// undated comments attach to the next dated row, trailing ones stay at the end.
function fillShiftsGridCells(selectedCells, tabCells, holidayTexts, globalCells, topIndex) {
  var holidays = new Set();
  (holidayTexts || []).forEach(function (text) { var day = parseDay(text ?? ''); if (day !== null) holidays.add(day); });
  var localSets = sortRows(rowsOfType(rowsFromCells(tabCells), 'set'));
  var globalSets = rowsOfType(rowsFromCells(globalCells || []), 'set');
  var timeline = new SettingsTimeline(localSets, holidays, globalSets);
  var datedSets = localSets.filter(function (r) { return isFinite(r.start); });
  var firstStart = datedSets.length ? datedSets[0].start : null;
  if (firstStart === null || timeline.gridAt(firstStart) === null) {
    return { error: 'the tab needs a dated set row with a period and an anchor in force before the grid can be filled' };
  }
  var rows = [];
  var comments = [];
  var pre = 0, post = 0, datedCount = 0;
  var above = null;
  for (var k = (topIndex || 0) - 1; k >= 0 && above === null; k--) {
    var earlier = rowFromArray(tabCells[k], k + 2);
    if (earlier.type !== 'comment' && earlier.type !== 'error' && earlier.start !== null && isFinite(earlier.start)) above = earlier.start;
  }
  for (var i = 0; i < selectedCells.length; i++) {
    var cells = selectedCells[i];
    var startText = cellText(cells[1]);
    var row = rowFromArray(cells, i + 1);
    row.cells = cells.slice();
    if (startText === '') {
      if (isBlankRow(cells) || isTemplateShiftRow(cells)) { if (datedCount) post++; else pre++; continue; }
      if (row.type === 'comment') { comments.push(row); continue; }
      if (!isEpochRow(row)) return { error: 'selected row ' + (i + 1) + ' has content but no start' };
      if (above !== null) { row.start = above; row.cells[1] = formatDateTime(above); }
    } else {
      if (row.start === null) return { error: 'selected row ' + (i + 1) + ': bad start "' + startText + '"' };
      if (row.start < firstStart) return { error: 'selected row ' + (i + 1) + ' is dated before the first set row' };
      if (row.type === 'comment' && hasOnlyStart(cells)) row.type = 'shift';
      if (row.type !== 'comment') above = row.start;
      datedCount++;
      post = 0;
    }
    if (row.type !== 'comment') row.cells[2] = row.type;
    rows = rows.concat(comments, [row]);
    comments = [];
  }
  if (!datedCount) return { error: 'the selection has no dated row to start from' };
  var out = gridRows(rows, pre, post, timeline).concat(comments);
  var firstOut = out.find(function (r) { return r.start !== null && isFinite(r.start); });
  if (firstOut && firstOut.start < firstStart) return { error: pre + ' empty row(s) above would fall before the first set row' };
  return { rows: out.map(function (r) { return r.cells || rowToArray(r); }) };
}

// ---- 72_presets.js ----
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

// The cells (sorted ledger or #Global rows) with an error row for each message above the set row that put
// `key` in force at now: the last set row at or before now whose what sets it, same start so the ledger order
// keeps it there; null when no such row exists.
function cellsWithSettingErrors(cells, now, key, messages) {
  var found = -1;
  cells.forEach(function (c, i) {
    var row = rowFromArray(c, i + 2);
    if (row.type !== 'set' || row.start === null) return;
    if (now !== null && now !== undefined && row.start > now) return;
    var parsed = parseSetArg(row.what, row.start);
    if (parsed.error === null && key in parsed.values && parsed.reset.indexOf(key) < 0) found = i;
  });
  if (found < 0) return null;
  var out = cells.slice();
  var rows = messages.map(function (m) { return rowToArray(makeRow({ type: 'error', startText: cells[found][1], what: m })); });
  out.splice.apply(out, [found, 0].concat(rows));
  return out;
}

// In-place error rows for the plan errors an extension's setting value causes (DESIGN 6): the errors with
// `setting` equal to key go above the set row that carries it in the rotation tab, or in #Global (prefixed
// with the rotation) when the value comes from there. The result's cells are updated too, so the CLI prints
// them; the core drops error rows on its next read.
function writeSettingErrors(result, storage, errors, key) {
  var byTarget = {};
  errors.filter(function (e) { return e.setting === key; }).forEach(function (e) {
    var rot = result.status.rotations.find(function (r) { return r.name === e.rotation; });
    var setting = rot && rot.settings.values.find(function (s) { return s.key === key; });
    var global = Boolean(setting && setting.source === 'global');
    var target = global ? GLOBAL_TAB : e.rotation;
    (byTarget[target] = byTarget[target] || []).push(global ? e.rotation + ': ' + e.message : e.message);
  });
  Object.keys(byTarget).forEach(function (target) {
    var global = target === GLOBAL_TAB;
    var cells = global ? result.global : result.ledgers[target];
    var out = cells ? cellsWithSettingErrors(cells, result.status.at, key, byTarget[target]) : null;
    if (!out) return;
    if (global) { result.global = out; storage.writeGlobal(out); } else { result.ledgers[target] = out; storage.writeLedger(target, out); }
  });
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

// ---- 75_extensions.js ----
// Optional extensions (DESIGN 8, Extensions). An extension is a separate bundle dist/<Name>.js built from
// src/ext/<Name>/*.js; it defines global functions <prefix>_<hook> where the prefix is the lower-case name.
// The core never registers anything: hooks are probed with typeof when they are called, so an extension that
// is not installed is simply skipped and file load order never matters.
var EXTENSIONS = ['GCal', 'Slack'];
var EXTENSION_HOOKS = ['menu', 'setup', 'setupTab', 'help', 'readInputs', 'afterRun', 'status'];

function extensionPrefix(name) {
  return name.toLowerCase();
}

function extensionHookName(name, hook) {
  return extensionPrefix(name) + '_' + hook;
}

// The hook function of one extension, or null. globalThis is the shared script scope in Apps Script and in
// the Node loader alike.
function extensionHook(name, hook) {
  var fn = globalThis[extensionHookName(name, hook)];
  return typeof fn === 'function' ? fn : null;
}

// [{ name, prefix, fn }] for every extension defining the hook, in EXTENSIONS order.
function extensionHooks(hook) {
  var out = [];
  EXTENSIONS.forEach(function (name) {
    var fn = extensionHook(name, hook);
    if (fn) out.push({ name: name, prefix: extensionPrefix(name), fn: fn });
  });
  return out;
}

// An extension counts as installed when any of its hooks is defined.
function extensionInstalled(name) {
  return EXTENSION_HOOKS.some(function (hook) { return extensionHook(name, hook) !== null; });
}

function extensionErrorMessage(h, e) {
  return h.name + ' extension: ' + (e && e.message ? e.message : String(e));
}

// Status error entry for a failed hook: shows in the errors block like a ledger error.
function extensionError(h, e) {
  return { rotation: h.name, rowIndex: null, start: null, message: extensionErrorMessage(h, e) };
}

function logExtensionError(h, e) {
  if (typeof console !== 'undefined') console.log(extensionErrorMessage(h, e));
}

// Calls <prefix>_<hook> of every listed extension with args, in order; returns [{ name, prefix, value }] for
// the calls that returned. An exception in a hook never reaches the core: onError(h, error) is called (a
// console line by default) and that extension is skipped.
function callExtensionHooks(hook, args, onError) {
  var out = [];
  extensionHooks(hook).forEach(function (h) {
    try {
      out.push({ name: h.name, prefix: h.prefix, value: h.fn.apply(null, args) });
    } catch (e) {
      (onError || logExtensionError)(h, e);
    }
  });
  return out;
}

// ---- 80_runner.js ----
function isBlankRow(cells) {
  return cells.every(function (c) { return cellText(c) === ''; });
}

function describeError(e) {
  var where = e.rowIndex !== null && e.rowIndex !== undefined ? 'row ' + e.rowIndex
    : e.start !== null && e.start !== undefined ? formatDateTime(e.start) : 'ledger';
  return e.rotation + ' ' + where + ': ' + e.message;
}

// Rows of a tab as read: blank rows dropped, undated rows dated from the row above (DESIGN 3.4).
function rowsFromCells(cells) {
  return inheritStarts(cells
    .map(function (row, i) { return isBlankRow(row) ? null : rowFromArray(row, i + 2); })
    .filter(Boolean));
}

// Settings that only an extension acts on: the warning names the extension when the setting is in force
// while the extension is not installed (DESIGN 8, Extensions).
var EXTENSION_SETTINGS = [
  { extension: 'GCal', key: 'cal', label: 'calendar' },
  { extension: 'Slack', key: 'slack', label: 'slack' },
];

// Warning per rotation and extension setting that names presets at the status instant while the extension
// is not installed to act on them.
function missingExtensionWarnings(status) {
  var out = [];
  EXTENSION_SETTINGS.forEach(function (es) {
    if (extensionInstalled(es.extension)) return;
    status.rotations.forEach(function (rot) {
      var setting = rot.settings.values.find(function (s) { return s.key === es.key; });
      if (setting && setting.value !== '') out.push({ rotation: rot.name, start: null, message: es.label + ' extension not installed; ' + es.key + '=' + setting.value + ' has no effect' });
    });
  });
  return out;
}

// Read, advance, regenerate and optionally write back through a Storage (DESIGN 8).
// options: write, mode, rotations (names to regenerate; the others are read but not written).
// Returns { ledgers, read, global, errors, status, ext }; ledgers holds only the regenerated ones, read every
// rotation as read (frozen ones included), and global is null when there is no #Global tab. A bad now, holiday cell or rotation name stops the run with nothing written.
// Extension hooks: <prefix>_readInputs(storage) before regenerate, its value kept in ext[prefix];
// <prefix>_afterRun(result, storage, options) when the run had no errors, after the ledgers are written and
// before the status tabs, so what it records in result.status reaches <prefix>_status. A hook that throws
// never fails the run: the failure is an error of the run and of the status (errors block), and afterRun is
// skipped when readInputs failed.
function runStorage(storage, nowText, options) {
  options = options || {};
  var errors = [];
  var extErrors = [];
  var onExtensionError = function (h, e) { extErrors.push(extensionError(h, e)); };
  var extMessages = function () { return extErrors.map(function (e) { return e.message; }); };
  var ext = {};
  callExtensionHooks('readInputs', [storage], onExtensionError).forEach(function (r) { ext[r.prefix] = r.value; });
  var ledgers = storage.readLedgers();
  var only = options.rotations || null;
  (only || []).forEach(function (name) { if (!(name in ledgers)) errors.push('unknown rotation "' + name + '"'); });
  var now = parseDateTime(nowText ?? '');
  if (now === null) errors.push('bad now "' + (nowText ?? '') + '"');
  var holidays = [];
  storage.readHolidays().forEach(function (text, i) {
    if (text === null) return;
    var day = parseDay(text);
    if (day === null) errors.push('holidays row ' + (i + 2) + ': bad date "' + text + '"');
    else holidays.push(day);
  });
  var globalCells = storage.readGlobal();
  var ignored = storage.ignoredTabs();
  if (errors.length) return { ledgers: ledgers, read: ledgers, global: null, errors: errors.concat(extMessages()), status: null, ext: ext };

  var globalRows = rowsFromCells(globalCells);
  var globalSets = rowsOfType(globalRows, 'set');
  var rotations = Object.keys(ledgers).map(function (name) {
    var rows = rowsFromCells(ledgers[name]);
    return { name: name, rows: rows, snapshotAt: advance(rows, now, new Set(holidays), globalSets) };
  });
  var globalCount = globalRows.filter(function (r) { return r.type !== 'error' && r.type !== 'comment'; }).length;
  var result = regenerate({ rotations: rotations, holidays: holidays, global: globalRows, now: now, only: only });
  var out = {};
  result.rotations.forEach(function (r) { out[r.name] = r.rows.map(rowToArray); });
  var global = globalCells.length ? result.global.rows.map(rowToArray) : null;
  result.errors.forEach(function (e) { errors.push(describeError(e)); });
  result.status.now = nowText;
  result.status.mode = options.mode || (options.write ? 'run' : 'preview');
  result.status.tabs = {
    rotations: Object.keys(ledgers), regenerated: result.regenerated ? Object.keys(out) : [],
    holidays: holidays.length, global: globalCount, ignored: ignored,
  };
  result.status.warnings = result.status.warnings.concat(missingExtensionWarnings(result.status));
  if (options.write) {
    Object.keys(out).forEach(function (name) { storage.writeLedger(name, out[name]); });
    if (global) storage.writeGlobal(global);
  }
  var run = { ledgers: out, read: ledgers, global: global, errors: errors, status: result.status, ext: ext };
  if (!errors.length && !extErrors.length) callExtensionHooks('afterRun', [run, storage, options], onExtensionError);
  extErrors.forEach(function (e) { result.status.errors.push(e); errors.push(e.message); });
  if (options.write) storage.writeStatus(result.status);
  return run;
}

// One line per error and per warning of a run, for the Apps Script executions log and the CLI's stderr
// (DESIGN 6): 'error: <text>' and 'warning: <rotation> <start>: <message>' (no start when the warning has none).
function runLogLines(result) {
  var lines = result.errors.map(function (e) { return 'error: ' + e; });
  (result.status ? result.status.warnings : []).forEach(function (w) {
    var where = w.rotation + (w.start === null || w.start === undefined ? '' : ' ' + formatDateTime(w.start));
    lines.push('warning: ' + where + ': ' + w.message);
  });
  return lines;
}

// Closing words of a run's toast (DESIGN 10.4): the counts cover core and extension errors and warnings alike.
function finishedText(errors, warnings) {
  return errors || warnings ? 'finished with ' + errors + ' error(s) and ' + warnings + ' warning(s)' : 'finished, no errors';
}

// Long-run guard (DESIGN 10.4). A loop that could outlive the Apps Script execution limit asks stopReason()
// between steps: 'aborted' when the user asked to abort, 'budget' when the run has used its time budget,
// else null. start and clock() are milliseconds, aborted() reads the abort flag; both are injected so the
// decision is testable. The Apps Script adapter arms a real one in withLock.
function runGuard(options) {
  var start = options.start;
  var budget = options.budgetSeconds === undefined ? null : options.budgetSeconds;
  var clock = options.clock;
  var aborted = options.aborted || function () { return false; };
  return {
    elapsedSeconds: function () { return Math.round((clock() - start) / 1000); },
    stopReason: function () {
      if (aborted()) return 'aborted';
      if (budget !== null && clock() - start >= budget * 1000) return 'budget';
      return null;
    },
  };
}

// Text for the status and the toast when a loop stopped early after `done` steps of `what`.
function stopNote(reason, done, what) {
  var after = 'after ' + done + ' ' + what;
  return reason === 'aborted' ? 'aborted ' + after : 'time budget reached ' + after + '; the next run continues';
}

// A flag read through read() at most once per intervalMs (clock in milliseconds), the value cached in
// between, so a loop asking before every step costs few service calls.
function throttledFlag(read, intervalMs, clock) {
  var last = -Infinity;
  var value = false;
  return function () {
    var now = clock();
    if (now - last >= intervalMs) { value = read(); last = now; }
    return value;
  };
}

// Progress reported through report(...) at most once per intervalMs (clock in milliseconds): the first call
// reports, later calls only once the interval has passed since the last report. Returns whether it reported.
function throttledProgress(report, intervalMs, clock) {
  var last = -Infinity;
  return function () {
    var now = clock();
    if (now - last < intervalMs) return false;
    last = now;
    report.apply(null, arguments);
    return true;
  };
}

// The guard of the run in progress, set by the adapter; outside a guarded run (Node, a call without the lock)
// a guard that never stops and reports no elapsed time.
var activeRunGuard = null;

function currentRunGuard() {
  return activeRunGuard || runGuard({ start: 0, clock: function () { return 0; } });
}

// ---- 90_gas.js ----
// Apps Script entry points and Sheets adapter. Not loaded by Node tests. Tab names are in 10_model.js.

var CELL_DATETIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
var CELL_DATE_FORMAT = 'yyyy-MM-dd';
var TRIGGER_HANDLER = 'run';
var LOCK_WAIT_MS = 5000;
var RUN_BUDGET_SECONDS = 300;
var ABORT_PROPERTY = 'rotalator.abort';
var ABORT_CHECK_MS = 3000;
var LOCK_BUSY_MESSAGE = 'another Rotalator run is in progress';
var FONT_FAMILY = 'Roboto Mono';
var TAB_COLOR_GENERATED = '#4285f4';
var TAB_COLOR_EDITABLE = '#9e9e9e';
var TAB_COLOR_HELP = '#76a5af';
var HELP_COLUMN_WIDTH = 900;
var HELP_COLUMNS = 1;
var DEFAULT_ROTATION_TAB = 'Rotation 1 Primary';
var LEDGER_COLUMN_WIDTHS = { pin: 40, start: 150, type: 80, what: 320, end: 150, duration: 80, note: 640 };
var HOLIDAYS_COLUMN_WIDTHS = { date: 110, note: 640 };
var SHIFTS_MIN_COLUMN_WIDTH = 120;
// #Status: keys | names or dates | dates | gap | gap | member | mark | score | projected | last | next |
// exclusions | gap | gap | setting | value | source.
var STATUS_COLUMN_WIDTHS = [100, 150, 150, 60, 60, 120, 60, 100, 100, 150, 150, 150, 60, 60, 100, 150, 100];

// Pastel palette (DESIGN 10.1).
var COLOR_HEADER = '#eeeeee';
var COLOR_DIVIDER = '#d9ead3';
var COLOR_ERROR = '#f4c7c3';
var COLOR_WARNING = '#fce5cd';
var COLOR_SETTINGS = '#c9daf8';
var COLOR_ROSTER = '#d0e0e3';
var COLOR_SNAPSHOT = '#d9ead3';
var COLOR_COMMENT = '#fff2cc';
var COLOR_CURRENT_CELL = COLOR_COMMENT;
var COLOR_RELATION = '#d9ead3';
var COLOR_DETACH = '#efefef';

// Conditional formatting over A:G, keyed on the type cell; comment rows have content but no type.
var COMMENT_FORMULA = '=AND($C1="", COUNTA($A1:$G1)>0)';
var LEDGER_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="team", $C1="join", $C1="leave", $C1="include", $C1="exclude")', color: COLOR_ROSTER },
  { formula: '=$C1="snapshot"', color: COLOR_SNAPSHOT },
  { formula: '=OR($C1="attract", $C1="attract!", $C1="repel", $C1="repel!")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];
var GLOBAL_FORMAT_RULES = [
  { formula: '=$C1="error"', color: COLOR_ERROR },
  { formula: '=OR($C1="set", $C1="score")', color: COLOR_SETTINGS },
  { formula: '=OR($C1="attract", $C1="attract!", $C1="repel", $C1="repel!")', color: COLOR_RELATION },
  { formula: '=$C1="detach"', color: COLOR_DETACH },
  { formula: COMMENT_FORMULA, color: COLOR_COMMENT },
];

// Storage interface of DESIGN 8 over the active spreadsheet. With preview set, ledgers are written to
// '#Preview <rotation>' tabs instead of the ledger tabs and #Global is not written at all. Ledgers are
// written as plain text only.
class SheetsStorage {
  constructor(spreadsheet, options) {
    this.ss = spreadsheet;
    this.tz = spreadsheet.getSpreadsheetTimeZone();
    this.preview = Boolean(options && options.preview);
    this.nowText = Utilities.formatDate(new Date(), this.tz, CELL_DATETIME_FORMAT);
    this.tabs = null;
  }

  isDateCell(cell) {
    return Object.prototype.toString.call(cell) === '[object Date]';
  }

  formatCell(cell, pattern) {
    return this.isDateCell(cell) ? Utilities.formatDate(cell, this.tz, pattern) : cell;
  }

  // Cell values with real Date cells converted to canonical text in the spreadsheet time zone.
  readValues(sheet, pattern) {
    var self = this;
    return sheet.getDataRange().getValues().map(function (row) {
      return row.map(function (cell) { return self.formatCell(cell, pattern); });
    });
  }

  // Rotations are the non-'#' tabs with the ledger header; only the ledger columns are read. Every other tab
  // except the known system tabs is reported as ignored, so a disabled '#<rotation>' shows up in #Status.
  scanTabs() {
    if (this.tabs) return this.tabs;
    var ledgers = {};
    var ignored = [];
    var self = this;
    this.ss.getSheets().forEach(function (sheet) {
      var name = sheet.getName();
      if (isSystemTab(name)) {
        if (!isKnownSystemTab(name)) ignored.push(name);
        return;
      }
      var header = headerCells(sheet);
      if (!isLedgerHeader(header)) { ignored.push(name); return; }
      ledgers[name] = self.readValues(sheet, CELL_DATETIME_FORMAT).slice(1)
        .map(function (row) { return row.slice(0, LEDGER_HEADER.length); });
    });
    this.tabs = { ledgers: ledgers, ignored: ignored };
    return this.tabs;
  }

  readLedgers() {
    return this.scanTabs().ledgers;
  }

  ignoredTabs() {
    return this.scanTabs().ignored.slice();
  }

  // Date texts per row after the header, null for blank rows so row numbers stay aligned.
  readHolidays() {
    var sheet = this.ss.getSheetByName(HOLIDAYS_TAB);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATE_FORMAT);
    var body = rows.length && cellText(rows[0][0]).toLowerCase() === 'date' ? rows.slice(1) : rows;
    return body.map(function (r) { return isBlankRow(r) ? null : cellText(r[0]); });
  }

  // The #Global tab must carry the ledger header; anything else is ignored.
  readGlobal() {
    var sheet = this.ss.getSheetByName(GLOBAL_TAB);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATETIME_FORMAT);
    return rows.length && isLedgerHeader(rows[0]) ? rows.slice(1).map(function (row) { return row.slice(0, LEDGER_HEADER.length); }) : [];
  }

  // Rows below the header of any tab, for extensions: [] when the tab is missing or its first row is not the
  // header (case-insensitive); only the header's columns are returned.
  readTabRows(name, header) {
    var sheet = this.ss.getSheetByName(name);
    if (!sheet) return [];
    var rows = this.readValues(sheet, CELL_DATETIME_FORMAT);
    var matches = rows.length && header.every(function (h, i) { return cellText(rows[0][i]).toLowerCase() === h; });
    return matches ? rows.slice(1).map(function (row) { return row.slice(0, header.length); }) : [];
  }

  // Rows below the header of any tab, written back in full, for extensions: the mirror of readTabRows. A
  // missing tab is created with the header as its first row; rows are cut or padded to the header width.
  writeTabRows(name, header, rows) {
    var sheet = this.ss.getSheetByName(name);
    if (!sheet) {
      sheet = this.ss.insertSheet(name);
      this.writeTextRows(sheet, 1, [header]);
      this.formatTableRows(sheet, header.length, { headerRows: [0] });
      sheet.setFrozenRows(1);
    }
    var last = sheet.getLastRow();
    if (last > 1) sheet.getRange(2, 1, last - 1, header.length).clearContent();
    var cells = rows.map(function (row) { return header.map(function (_, i) { return row[i] === undefined || row[i] === null ? '' : row[i]; }); });
    this.writeTextRows(sheet, 2, cells);
  }

  sheetNamed(name) {
    return this.ss.getSheetByName(name) || this.ss.insertSheet(name);
  }

  // A missing preview tab is created right after the tab it previews; an existing one is never moved.
  previewSheet(name) {
    var sheet = this.ss.getSheetByName(previewTabName(name));
    if (sheet) return sheet;
    var base = this.ss.getSheetByName(name);
    return this.ss.insertSheet(previewTabName(name), base ? base.getIndex() : this.ss.getNumSheets());
  }

  writeTextRows(sheet, row, rows) {
    writeTextCells(sheet, row, rows);
  }

  // Bold grey header rows, a green divider, red error rows, orange warning rows, yellow current cells and
  // red error cells with a note, from the 0-based indexes the status module reports in table { headerRows,
  // dividerRows, errorRows, warningRows, currentCells, errorCells }. Red wins over yellow on a cell.
  formatTableRows(sheet, width, table) {
    var paint = function (indexes, color) {
      (indexes || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setBackground(color); });
    };
    (table.headerRows || []).forEach(function (i) { sheet.getRange(i + 1, 1, 1, width).setFontWeight('bold'); });
    paint(table.headerRows, COLOR_HEADER);
    paint(table.dividerRows, COLOR_DIVIDER);
    paint(table.errorRows, COLOR_ERROR);
    paint(table.warningRows, COLOR_WARNING);
    (table.currentCells || []).forEach(function (c) { sheet.getRange(c.row + 1, c.col + 1).setBackground(COLOR_CURRENT_CELL); });
    (table.errorCells || []).forEach(function (c) { sheet.getRange(c.row + 1, c.col + 1).setBackground(COLOR_ERROR).setNote(c.note); });
  }

  // Rows below the header of a ledger-shaped tab. A preview goes to '#Preview <name>', rewritten with a fresh
  // header and formatted like a rotation tab (formatTab, DESIGN 10.1), so Set Up and the writer agree.
  writeLedgerRows(name, rows) {
    var sheet;
    if (this.preview) {
      sheet = this.previewSheet(name);
      sheet.clear();
      this.writeTextRows(sheet, 1, [LEDGER_HEADER]);
    } else {
      sheet = this.ss.getSheetByName(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.getRange(2, 1, last - 1, LEDGER_HEADER.length).clearContent();
    }
    this.writeTextRows(sheet, 2, rows);
    if (this.preview) formatTab(sheet);
  }

  writeLedger(rotation, rows) {
    this.writeLedgerRows(rotation, rows);
  }

  // A preview reads #Global as usual and writes nothing for it.
  writeGlobal(rows) {
    if (!this.preview) this.writeLedgerRows(GLOBAL_TAB, rows);
  }

  // Generated tabs are cleared with their formats and rewritten; table: { rows, headerRows, dividerRows, currentCells }.
  writeTable(name, table) {
    var sheet = this.sheetNamed(name);
    sheet.clear();
    this.writeTextRows(sheet, 1, table.rows);
    if (table.rows.length) this.formatTableRows(sheet, table.rows[0].length, table);
  }

  // #Status and #All shifts tabs, rewritten in full from the status data (DESIGN 5.8).
  writeStatus(data) {
    this.writeTable(STATUS_TAB, statusRows(data));
    var shifts = shiftsRows(data);
    this.writeTable(ALL_SHIFTS_TAB, shifts);
    var sheet = this.ss.getSheetByName(ALL_SHIFTS_TAB);
    var width = shifts.rows[0].length;
    sheet.setFrozenRows(1);
    trimColumns(sheet, width);
    // Columns fit their content, never narrower than the minimum.
    sheet.autoResizeColumns(1, width);
    for (var c = 1; c <= width; c++) {
      if (sheet.getColumnWidth(c) < SHIFTS_MIN_COLUMN_WIDTH) sheet.setColumnWidth(c, SHIFTS_MIN_COLUMN_WIDTH);
    }
  }
}

// Core items first, then each installed extension adds its own (<prefix>_menu(menu)); a failing extension is
// logged and the menu is installed without its items.
function onOpen() {
  var menu = SpreadsheetApp.getUi().createMenu('Rotalator')
    .addItem('Run', 'run')
    .addItem('Run - preview', 'previewRun')
    .addItem('Run for current rotation', 'runCurrent')
    .addItem('Run for current rotation - preview', 'previewRunCurrent')
    .addItem('Abort run', 'abortRun')
    .addSeparator()
    .addItem('Set Up Spreadsheet', 'setupSpreadsheet')
    .addItem('Set Up Tab', 'setupTab')
    .addItem('Fill Shifts Grid', 'fillShiftsGrid')
    .addSeparator()
    .addItem('Install nightly trigger', 'installTrigger')
    .addItem('Remove trigger', 'removeTrigger');
  callExtensionHooks('menu', [menu], logExtensionError);
  menu.addToUi();
}

// On errors the ledgers are still written: rows unchanged plus error rows (DESIGN 6).
// rotations: names to regenerate, or null for all.
function runWith(preview, rotations) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss, { preview: preview });
  var options = { write: true, mode: preview ? 'preview' : 'run' };
  if (rotations) options.rotations = rotations;
  var result = runStorage(storage, storage.nowText, options);
  var title = preview ? 'Rotalator preview' : 'Rotalator';
  var what = rotations ? rotations.join(', ') : Object.keys(result.ledgers).length + ' rotation(s)';
  var done = result.status ? what + ' ' + (preview ? 'previewed' : 'updated') + ' at ' + storage.nowText : result.errors[0];
  var warnings = result.status ? result.status.warnings.length : 0;
  var message = done + '; ' + finishedText(result.errors.length, warnings);
  runLogLines(result).forEach(function (line) { console.log(line); });
  ss.toast(message, title, 10);
  return result;
}

// One Rotalator run at a time (DESIGN 10.4): the script lock is shared by every user and the trigger. When
// it is not free within LOCK_WAIT_MS the action is skipped with a toast and a log line (the trigger has no
// UI) and nothing changes. Clears the abort flag, arms the run guard with the time budget and an abort check
// that reads the flag at most every ABORT_CHECK_MS, runs fn and always releases the lock. Extensions wrap
// their own menu actions with it.
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) { toast(LOCK_BUSY_MESSAGE); console.log(LOCK_BUSY_MESSAGE); return null; }
  try {
    PropertiesService.getScriptProperties().deleteProperty(ABORT_PROPERTY);
    activeRunGuard = runGuard({
      start: Date.now(), budgetSeconds: RUN_BUDGET_SECONDS, clock: Date.now,
      aborted: throttledFlag(abortRequested, ABORT_CHECK_MS, Date.now),
    });
    return fn();
  } finally {
    activeRunGuard = null;
    lock.releaseLock();
  }
}

// The abort flag is a script property, so a menu click reaches the run in progress.
function abortRequested() {
  return PropertiesService.getScriptProperties().getProperty(ABORT_PROPERTY) === '1';
}

// Menu: Abort run. When the lock is free no run is in progress and nothing is set (a stale flag would be
// discarded by the next run anyway); otherwise the flag is set and the run holding the lock stops at its next
// check.
function abortRun() {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(0)) { lock.releaseLock(); toast('no run in progress'); return false; }
  PropertiesService.getScriptProperties().setProperty(ABORT_PROPERTY, '1');
  toast('abort requested; the export or clean in progress stops at its next event');
  return true;
}

function run() {
  return withLock(function () { return runWith(false, null); });
}

function previewRun() {
  return withLock(function () { return runWith(true, null); });
}

// The active tab must be a rotation tab.
function currentRotation() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var name = sheet.getName();
  if (isSystemTab(name) || !isLedgerHeader(headerCells(sheet))) {
    toast('"' + name + '" is not a rotation tab');
    return null;
  }
  return name;
}

function runCurrent() {
  var name = currentRotation();
  return name === null ? null : withLock(function () { return runWith(false, [name]); });
}

function previewRunCurrent() {
  var name = currentRotation();
  return name === null ? null : withLock(function () { return runWith(true, [name]); });
}

function deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

function installTrigger() {
  deleteTriggers();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyDays(1).atHour(2).inTimezone(ss.getSpreadsheetTimeZone()).create();
  ss.toast('Nightly run installed between 02:00 and 03:00 ' + ss.getSpreadsheetTimeZone(), 'Rotalator', 10);
}

function removeTrigger() {
  deleteTriggers();
  SpreadsheetApp.getActiveSpreadsheet().toast('Nightly run removed', 'Rotalator', 10);
}

function toast(message, title) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, title || 'Rotalator', 10);
}

function isEmptySheet(sheet) {
  return sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
}

// Every cell top-left aligned, so multi-line notes and wrapped help read from the top like the header.
function alignTopLeft(range) {
  range.setVerticalAlignment('top').setHorizontalAlignment('left');
}

// Writes rows as plain text in the script font, top-left aligned, from `row` down, growing the grid first: a
// trimmed or narrowed tab may have fewer columns or rows than the data, and getRange beyond the grid throws
// instead of extending it.
function writeTextCells(sheet, row, rows) {
  if (!rows.length) return;
  var width = rows[0].length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  var last = row + rows.length - 1;
  if (sheet.getMaxRows() < last) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  var range = sheet.getRange(row, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setFontFamily(FONT_FAMILY);
  alignTopLeft(range);
  range.setValues(rows);
}

function writeHeaderRow(sheet, header) {
  writeTextCells(sheet, 1, [header]);
}

// Header, column widths and notes per tab kind; null for tabs the script does not shape: unknown '#' tabs,
// non-empty tabs without the ledger header and the tabs an extension owns (#GCal, #Slack, #Slack state).
function tabLayout(sheet) {
  var name = sheet.getName();
  if (extensionTabOwner(name) !== null) return null;
  if (name === HOLIDAYS_TAB) return { header: HOLIDAYS_HEADER, widths: HOLIDAYS_COLUMN_WIDTHS, notes: true, freeze: true };
  if (name === ALL_SHIFTS_TAB) return { header: null, widths: null, notes: false, freeze: false };
  if (name === STATUS_TAB) return { header: null, widths: STATUS_COLUMN_WIDTHS, notes: false, freeze: false };
  if (name === HELP_TAB) return { header: null, widths: [HELP_COLUMN_WIDTH], keep: HELP_COLUMNS, notes: false, freeze: false };
  if (isSystemTab(name) && !isKnownSystemTab(name)) return null;
  if (!isSystemTab(name) && !isEmptySheet(sheet) && !isLedgerHeader(headerCells(sheet))) return null;
  return { header: LEDGER_HEADER, widths: LEDGER_COLUMN_WIDTHS, notes: true, freeze: true };
}

// First-row cells of the ledger columns, padded to the ledger width; a tab narrower than the ledger has no
// header (getRange beyond the grid would throw).
function headerCells(sheet) {
  var cols = Math.min(LEDGER_HEADER.length, sheet.getMaxColumns());
  var cells = sheet.getRange(1, 1, 1, cols).getValues()[0];
  while (cells.length < LEDGER_HEADER.length) cells.push('');
  return cells;
}

// Deletes the columns beyond `width` when they hold nothing, so the trim never removes content.
function trimColumns(sheet, width) {
  if (sheet.getMaxColumns() > width && sheet.getLastColumn() <= width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
}

// Replaces the tab's conditional format rules with the script's set, one rule per formula over A:G.
function setConditionalRules(sheet, rules, width) {
  var range = sheet.getRange('A:' + String.fromCharCode(64 + width));
  sheet.setConditionalFormatRules(rules.map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(r.formula).setBackground(r.color).setRanges([range]).build();
  }));
}

// Idempotent formatting: font and top-left alignment on the whole tab, plain text on the whole ledger columns
// (A:G), bold grey frozen header, widths, notes and spare columns removed on tabs that have their header,
// conditional row colours on rotation tabs, their previews and #Global, tab colour on system tabs. Never
// touches cell values.
function formatTab(sheet) {
  var name = sheet.getName();
  var layout = tabLayout(sheet);
  if (!layout) return;
  var all = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  all.setFontFamily(FONT_FAMILY);
  alignTopLeft(all);
  var width = layout.header ? layout.header.length : layout.widths ? layout.widths.length : STATUS_WIDTH;
  var present = Math.min(width, sheet.getMaxColumns());
  sheet.getRange('A:' + String.fromCharCode(64 + present)).setNumberFormat('@');
  if (!layout.header && layout.widths) layout.widths.slice(0, present).forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  if (layout.header && !isEmptySheet(sheet)) {
    var header = sheet.getRange(1, 1, 1, width);
    header.setFontWeight('bold').setBackground(COLOR_HEADER);
    if (layout.freeze) sheet.setFrozenRows(1);
    layout.header.forEach(function (column, i) {
      sheet.setColumnWidth(i + 1, layout.widths[column]);
      if (layout.notes && COLUMN_NOTES[column]) header.getCell(1, i + 1).setNote(COLUMN_NOTES[column]);
    });
    trimColumns(sheet, width);
  }
  if (!layout.header && layout.keep) trimColumns(sheet, layout.keep);
  if (!isSystemTab(name) || isPreviewTab(name)) setConditionalRules(sheet, LEDGER_FORMAT_RULES, LEDGER_HEADER.length);
  if (name === GLOBAL_TAB) setConditionalRules(sheet, GLOBAL_FORMAT_RULES, LEDGER_HEADER.length);
  if (isSystemTab(name)) {
    var editable = name === HOLIDAYS_TAB || name === GLOBAL_TAB;
    sheet.setTabColor(name === HELP_TAB ? TAB_COLOR_HELP : editable ? TAB_COLOR_EDITABLE : TAB_COLOR_GENERATED);
  }
}

// Moves the tab to the 1-based position and restores the previously active tab.
function moveTab(ss, sheet, position) {
  var active = ss.getActiveSheet();
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(position);
  ss.setActiveSheet(active);
}

// A tab directly after its anchor: moved there once when it sits elsewhere; nothing without an anchor. A tab
// coming from before the anchor lands at the anchor's current index, since the anchor shifts up when it leaves.
function placeTabAfter(ss, sheet, anchor) {
  if (!anchor || sheet.getIndex() === anchor.getIndex() + 1) return;
  moveTab(ss, sheet, sheet.getIndex() < anchor.getIndex() ? anchor.getIndex() : anchor.getIndex() + 1);
}

// Formats an extension's preset tab like an editable system tab: script font, wrapped and top-left aligned,
// plain text, bold grey frozen header, the widths given, spare columns removed, the row colour rules given
// ({ formula, color }) replacing the tab's, grey tab colour.
function formatPresetTab(sheet, widths, rules) {
  var width = PRESET_HEADER.length;
  var all = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  all.setFontFamily(FONT_FAMILY);
  all.setWrap(true);
  alignTopLeft(all);
  sheet.getRange('A:' + String.fromCharCode(64 + width)).setNumberFormat('@');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(COLOR_HEADER);
  sheet.setFrozenRows(1);
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  trimColumns(sheet, width);
  setConditionalRules(sheet, rules, width);
  sheet.setTabColor(TAB_COLOR_EDITABLE);
}

// #Global directly before #Holidays; only moves when both exist and #Holidays comes first.
function orderGlobalBeforeHolidays(ss) {
  var global = ss.getSheetByName(GLOBAL_TAB);
  var holidays = ss.getSheetByName(HOLIDAYS_TAB);
  if (global && holidays && holidays.getIndex() < global.getIndex()) moveTab(ss, global, holidays.getIndex());
}

// #Help: helpText() in column A, first line and headings bold, moved to the last position; the active tab is kept.
function writeHelpTab(ss) {
  var sheet = ss.getSheetByName(HELP_TAB) || ss.insertSheet(HELP_TAB);
  sheet.clear();
  var lines = helpText();
  var range = sheet.getRange(1, 1, lines.length, 1);
  range.setNumberFormat('@');
  range.setWrap(true);
  alignTopLeft(range);
  range.setValues(lines.map(function (line) { return [line]; }));
  helpHeadingRows(lines).forEach(function (i) { sheet.getRange(i + 1, 1).setFontWeight('bold'); });
  moveTab(ss, sheet, ss.getNumSheets());
  return sheet;
}

function ensureTab(ss, name, header) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (header) writeHeaderRow(sheet, header);
  } else if (header && isEmptySheet(sheet)) {
    writeHeaderRow(sheet, header);
  }
  return sheet;
}

// #Global gets its header and one comment row explaining the tab when created or still empty.
// Template rows for a tab by name: rotation, #Global or #Holidays; null for tabs without a template.
function templateFor(name, storage) {
  var now = parseDateTime(storage.nowText);
  if (name === GLOBAL_TAB) return globalTemplateRows();
  if (name === HOLIDAYS_TAB) return holidaysTemplateRows(now);
  if (isSystemTab(name)) return null;
  return templateRows(recentMonday(now));
}

function writeTemplate(sheet, rows) {
  writeTextCells(sheet, 1, rows);
}

// Creates a missing tab and fills an empty one from its template.
function ensureTemplateTab(ss, name, storage) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (isEmptySheet(sheet)) writeTemplate(sheet, templateFor(name, storage));
  return sheet;
}

// Menu: Set Up Spreadsheet. Creates missing system tabs, a first rotation when there is none, lets each
// installed extension add its tabs (<prefix>_setup(ss); a failure is logged and named in the toast), and
// formats every tab. Under the lock, so it never reshapes tabs a run is writing.
function setupSpreadsheet() {
  return withLock(setupSpreadsheetUnlocked);
}

function setupSpreadsheetUnlocked() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var storage = new SheetsStorage(ss);
  if (!Object.keys(storage.readLedgers()).length) {
    var first = ss.getSheetByName(DEFAULT_ROTATION_TAB) || ss.insertSheet(DEFAULT_ROTATION_TAB, 0);
    if (isEmptySheet(first)) writeTemplate(first, templateFor(DEFAULT_ROTATION_TAB, storage));
  }
  ensureTemplateTab(ss, GLOBAL_TAB, storage);
  ensureTemplateTab(ss, HOLIDAYS_TAB, storage);
  ensureTab(ss, STATUS_TAB, null);
  ensureTab(ss, ALL_SHIFTS_TAB, SHIFTS_HEADER);
  orderGlobalBeforeHolidays(ss);
  var failed = [];
  callExtensionHooks('setup', [ss], function (h, e) { logExtensionError(h, e); failed.push(extensionErrorMessage(h, e)); });
  writeHelpTab(ss);
  ss.getSheets().forEach(formatTab);
  toast('Tabs, formatting and #Help are in place' + (failed.length ? '; ' + failed.join('; ') : ''));
}

// Menu: Set Up Tab. Fills the active tab according to its name; never overwrites content. An installed
// extension may take the tab first (<prefix>_setupTab(sheet) returning true, DESIGN 8).
function setupTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  var taken = callExtensionHooks('setupTab', [sheet], logExtensionError).some(function (r) { return r.value === true; });
  if (taken) return;
  if (isSystemTab(name) && !isKnownSystemTab(name)) { toast('"' + name + '" starts with # and is not a system tab; rename it to use it as a rotation'); return; }
  var owner = extensionTabOwner(name);
  if (owner !== null) { toast('"' + name + '" belongs to the ' + owner + ' extension; use Set Up Spreadsheet with the extension installed'); return; }
  if (name === STATUS_TAB || name === ALL_SHIFTS_TAB || name === HELP_TAB || isPreviewTab(name)) { toast('"' + name + '" is written by the script; nothing to fill in'); return; }
  if (!isEmptySheet(sheet)) { toast('"' + name + '" is not empty; Set Up Tab only fills empty tabs'); return; }
  writeTemplate(sheet, templateFor(name, new SheetsStorage(ss)));
  formatTab(sheet);
  toast('"' + name + '" set up from the template');
}

// Menu: Fill Shifts Grid over the selected rows of a rotation tab (DESIGN 10). Under the lock: it rewrites
// start cells a concurrent run may be re-sorting.
function fillShiftsGrid() {
  return withLock(fillShiftsGridUnlocked);
}

function fillShiftsGridUnlocked() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  var header = headerCells(sheet);
  if (isSystemTab(name) || !isLedgerHeader(header)) { toast('"' + name + '" is not a rotation tab'); return; }
  var selection = sheet.getActiveRange();
  var top = selection.getRow();
  var count = selection.getNumRows();
  if (count < 2 || top < 2) { toast('select more than one row below the header'); return; }
  var storage = new SheetsStorage(ss);
  var region = sheet.getRange(top, 1, count, LEDGER_HEADER.length);
  var selected = region.getValues().map(function (row) {
    return row.map(function (cell) { return storage.formatCell(cell, CELL_DATETIME_FORMAT); });
  });
  var tab = storage.readValues(sheet, CELL_DATETIME_FORMAT).slice(1);
  var result = fillShiftsGridCells(selected, tab, storage.readHolidays(), storage.readGlobal(), top - 2);
  if (result.error) { toast(result.error); return; }
  var rows = result.rows;
  if (rows.length > count) sheet.insertRowsAfter(top + count - 1, rows.length - count);
  var target = sheet.getRange(top, 1, rows.length, LEDGER_HEADER.length);
  target.setNumberFormat('@');
  target.setValues(rows);
  sheet.setActiveRange(target);
  toast(rows.length + ' row(s) on the grid, ' + (rows.length - count) + ' inserted');
}

